/** Tests de l'équilibrage des équipes (node --test). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance, BalanceError, spread, TEAM_NAMES } from '../lib/balance.ts';
import type { Participant } from '../lib/types.ts';

/** Générateur pseudo-aléatoire déterministe (mulberry32) pour des tests stables. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function players(levels: number[]): Participant[] {
  return levels.map((level, i) => ({ id: `p${i}`, name: `Joueur ${i}`, level }));
}

test('refuse s’il n’y a pas de quoi former deux équipes', () => {
  assert.throws(() => balance(players([3, 3, 3]), 2), BalanceError);
  assert.throws(() => balance(players([]), 5), BalanceError);
  assert.throws(() => balance(players([1, 2]), 0), BalanceError);
});

test('les premiers inscrits jouent, les suivants sont remplaçants dans l’ordre', () => {
  const all = players([1, 2, 3, 4, 5, 6, 0, 2, 3, 4, 5, 6]);
  const { teams, subs } = balance(all, 5, rng(1));
  assert.equal(teams.length, 2);
  assert.deepEqual(
    subs.map((s) => s.id),
    ['p10', 'p11'],
  );
  const playing = teams.flatMap((t) => t.members.map((m) => m.id)).sort();
  assert.deepEqual(playing, all.slice(0, 10).map((p) => p.id).sort());
});

test('chaque joueur apparaît exactement une fois, équipes de la bonne taille', () => {
  const all = players([0, 1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1, 0, 3]);
  const { teams, subs } = balance(all, 4, rng(7));
  assert.equal(teams.length, 3);
  teams.forEach((t) => assert.equal(t.members.length, 4));
  const ids = [...teams.flatMap((t) => t.members.map((m) => m.id)), ...subs.map((s) => s.id)].sort();
  assert.deepEqual(ids, all.map((p) => p.id).sort());
});

test('écart nul quand une répartition parfaite existe', () => {
  const { teams } = balance(players([6, 6, 6, 6, 0, 0, 0, 0]), 4, rng(2));
  assert.equal(spread(teams), 0);
});

test('écart minimal (1) quand la somme totale est impaire', () => {
  const { teams } = balance(players([6, 5, 4, 3, 2, 1]), 3, rng(3));
  assert.equal(spread(teams), 1);
});

test('les échanges aléatoires améliorent un serpentin imparfait', () => {
  // Serpentin seul : [6,4,4]=14, [6,4,0]=10, [4,4,0]=8 → écart 6. Optimum : 2.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const { teams } = balance(players([6, 6, 4, 4, 4, 4, 4, 0, 0]), 3, rng(seed));
    assert.ok(spread(teams) <= 2, `écart ${spread(teams)} avec la graine ${seed}`);
  }
});

test('noms des équipes dans l’ordre des couleurs', () => {
  const { teams } = balance(players(Array(12).fill(3)), 2, rng(4));
  assert.equal(teams.length, 6);
  assert.deepEqual(
    teams.map((t) => t.name),
    TEAM_NAMES.slice(0, 6),
  );
});

test('les participants d’origine ne sont pas modifiés', () => {
  const all = players([3, 1, 4, 1, 5, 9]);
  const copy = JSON.parse(JSON.stringify(all));
  balance(all, 3, rng(5));
  assert.deepEqual(all, copy);
});
