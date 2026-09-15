/** Tests du store (versions, rotation de cycle, conflits) et du stockage fichiers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileKV, MemoryKV } from '../lib/kv.ts';
import { Store } from '../lib/store.ts';
import { CYCLE_MS } from '../lib/cycle.ts';
import type { MatchEvent } from '../lib/types.ts';

const T0 = Date.parse('2026-09-15T10:00:00Z');

function clock(start: number) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

function sampleEvent(): MatchEvent {
  return {
    title: 'Foot jeudi',
    teamSize: 5,
    createdBy: 'a',
    createdAt: new Date(T0).toISOString(),
    status: 'open',
    participants: [],
    teams: [],
    subs: [],
    rounds: [],
    winner: null,
  };
}

test('la première lecture fixe le début du cycle et persiste un état vide', async () => {
  const c = clock(T0);
  const store = new Store(new MemoryKV(), c.now);
  const initial = await store.getState();
  assert.equal(initial.version, 1, 'l’état vide est écrit une fois');
  assert.deepEqual(initial.players, {});
  assert.equal(initial.cycle.startedAt, new Date(T0).toISOString());

  c.advance(60_000);
  const again = await store.getState();
  assert.equal(again.version, 1, 'pas de nouvelle écriture');
  assert.equal(again.cycle.startedAt, initial.cycle.startedAt, 'le cycle ne redémarre pas');
});

test('mutate persiste et incrémente la version', async () => {
  const store = new Store(new MemoryKV(), () => T0);
  await store.getState();

  const { state } = await store.mutate((s) => {
    s.players.a = { name: 'Camille', level: 3, updatedAt: 'x' };
  });
  assert.equal(state.version, 2);
  const reread = await store.getState();
  assert.equal(reread.version, 2);
  assert.equal(reread.players.a.name, 'Camille');
});

test('une mutation qui lève une erreur n’écrit rien', async () => {
  const store = new Store(new MemoryKV(), () => T0);
  const before = await store.getState();
  await assert.rejects(
    store.mutate((s) => {
      s.players.a = { name: 'X', level: 1, updatedAt: 'x' };
      throw new Error('refusé');
    }),
    /refusé/,
  );
  const state = await store.getState();
  assert.equal(state.version, before.version);
  assert.deepEqual(state.players, {});
});

test('rotation après 48 h : archive les matchs, garde les joueurs', async () => {
  const c = clock(T0);
  const store = new Store(new MemoryKV(), c.now);
  await store.mutate((s) => {
    s.players.a = { name: 'Camille', level: 3, updatedAt: 'x' };
    s.events.e1 = sampleEvent();
  });
  const before = await store.getState();

  c.advance(CYCLE_MS - 1);
  assert.equal((await store.getState()).cycle.id, before.cycle.id, 'pas encore expiré');

  c.advance(2);
  const after = await store.getState();
  assert.notEqual(after.cycle.id, before.cycle.id);
  assert.deepEqual(after.events, {});
  assert.equal(after.players.a.name, 'Camille');

  const archive = await store.listArchive();
  assert.equal(archive.length, 1);
  assert.equal(archive[0].id, before.cycle.id);
  assert.equal(archive[0].startedAt, before.cycle.startedAt);
  assert.equal(archive[0].events.length, 1);
  assert.equal(archive[0].events[0].id, 'e1');
  assert.equal(archive[0].events[0].title, 'Foot jeudi');

  assert.equal(await store.rotateIfNeeded(), false);
});

test('un cycle sans match n’est pas archivé', async () => {
  const c = clock(T0);
  const store = new Store(new MemoryKV(), c.now);
  await store.getState();
  c.advance(CYCLE_MS + 1);
  assert.equal(await store.rotateIfNeeded(), true);
  assert.deepEqual(await store.listArchive(), []);
});

test('conflit d’écriture : la mutation est rejouée sur l’état à jour', async () => {
  const kv = new MemoryKV();
  const store = new Store(kv, () => T0);
  await store.mutate((s) => {
    s.players.a = { name: 'A', level: 1, updatedAt: 'x' };
  });

  // On simule une écriture concurrente juste avant le premier CAS.
  const originalCas = kv.cas.bind(kv);
  let calls = 0;
  kv.cas = async (key, versionKey, expected, next, value) => {
    calls++;
    if (calls === 1) {
      const concurrent = JSON.parse((await kv.get(key)) as string);
      concurrent.players.b = { name: 'B', level: 2, updatedAt: 'y' };
      await originalCas(key, versionKey, expected, next, JSON.stringify(concurrent));
    }
    return originalCas(key, versionKey, expected, next, value);
  };

  let applied = 0;
  const { state } = await store.mutate((s) => {
    applied++;
    s.players.c = { name: 'C', level: 3, updatedAt: 'z' };
  });
  assert.equal(calls, 2);
  assert.equal(applied, 2, 'la fonction a été rejouée');
  assert.equal(state.version, 3);
  assert.deepEqual(Object.keys(state.players).sort(), ['a', 'b', 'c']);
});

test('abonnements push : ajout, lecture, suppression', async () => {
  const store = new Store(new MemoryKV(), () => T0);
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } };
  await store.addSubscription({ playerId: 'a', subscription: sub, createdAt: 'x' });
  assert.equal((await store.getSubscriptions()).length, 1);
  await store.removeSubscription(sub.endpoint);
  assert.equal((await store.getSubscriptions()).length, 0);
});

test('FileKV : disposition des fichiers, écriture atomique, CAS, hachage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vestiaire-test-'));
  try {
    const kv = new FileKV(dir);
    const store = new Store(kv, () => T0);
    await store.mutate((s) => {
      s.events.e1 = sampleEvent();
    });
    const current = JSON.parse(await fs.readFile(path.join(dir, 'current.json'), 'utf8'));
    assert.equal(current.events.e1.title, 'Foot jeudi');
    assert.equal(await fs.readFile(path.join(dir, 'version.json'), 'utf8'), '1');
    const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'aucun fichier temporaire ne traîne');

    // CAS avec une version périmée : refusé.
    assert.equal(await kv.cas('vestiaire:current', 'vestiaire:version', 0, 5, '{}'), false);
    assert.equal(await kv.cas('vestiaire:current', 'vestiaire:version', 1, 2, '{"ok":true}'), true);
    assert.equal(await kv.get('vestiaire:current'), '{"ok":true}');

    // Archives → data/archive/<id>.json et listage par préfixe.
    await kv.set('vestiaire:archive:c-1', '{"a":1}');
    await kv.set('vestiaire:archive:c-2', '{"a":2}');
    assert.ok(await fs.stat(path.join(dir, 'archive', 'c-1.json')));
    assert.deepEqual((await kv.keys('vestiaire:archive:')).sort(), ['vestiaire:archive:c-1', 'vestiaire:archive:c-2']);

    // Table de hachage → data/push.json.
    await kv.hset('vestiaire:push', 'ep1', '{"x":1}');
    await kv.hset('vestiaire:push', 'ep2', '{"x":2}');
    await kv.hdel('vestiaire:push', 'ep1');
    assert.deepEqual(await kv.hgetall('vestiaire:push'), { ep2: '{"x":2}' });
    assert.ok(await fs.stat(path.join(dir, 'push.json')));

    // Clé inconnue → null, pas d'erreur.
    assert.equal(await kv.get('vestiaire:nope'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
