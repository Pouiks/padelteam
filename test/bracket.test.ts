/** Tests du tournoi à double élimination (node --test). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BracketError,
  championOf,
  createBracket,
  lossesOf,
  matchLabel,
  outcomes,
  progress,
  setResult,
  settle,
  teamIndexOf,
  teamStatus,
} from '../lib/bracket.ts';
import type { MatchEvent } from '../lib/types.ts';

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

interface Setup {
  seed?: number;
  courts?: number;
  reset?: boolean;
}

/** Tournoi lancé avec `nTeams` équipes d'un joueur (« j0 », « j1 », …). */
function makeEvent(nTeams: number, { seed = 1, courts = 2, reset = true }: Setup = {}): MatchEvent {
  return settle({
    title: 'test',
    teamSize: 1,
    courts,
    createdBy: 'p',
    createdAt: new Date(0).toISOString(),
    status: 'running',
    participants: [],
    teams: Array.from({ length: nTeams }, (_, i) => ({
      name: `T${i}`,
      members: [{ id: `j${i}`, name: `Joueur ${i}`, level: 3 }],
    })),
    subs: [],
    matches: createBracket(nTeams, rng(seed), { reset }),
    winner: null,
  });
}

/** Rencontres prêtes à jouer, avec leurs deux équipes. */
function ready(event: MatchEvent): Array<{ i: number; a: number; b: number }> {
  return outcomes(event.matches)
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.state === 'ready')
    .map(({ o, i }) => ({ i, a: o.a as number, b: o.b as number }));
}

/** Joue le tournoi jusqu'au bout ; `pick` choisit le vainqueur de chaque rencontre. */
function playOut(event: MatchEvent, pick: (a: number, b: number, i: number) => number): number {
  let played = 0;
  for (;;) {
    const next = ready(event)[0];
    if (!next) return played;
    setResult(event, next.i, { winner: pick(next.a, next.b, next.i) });
    played++;
    assert.ok(played < 200, 'le tournoi doit se terminer');
  }
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

test('4 équipes : 2 tours de gagnants, 2 de perdants, grande finale et revanche', () => {
  const event = makeEvent(4);
  const shape = event.matches.map((m) => `${m.side}:${m.round}@${m.stage}`);
  assert.deepEqual(shape, [
    'winners:0@0',
    'winners:0@0',
    'winners:1@1',
    'losers:0@1',
    'losers:1@2',
    'final:0@3',
    'final:1@4',
  ]);
  assert.equal(event.matches[6].reset, true);
});

test('4 équipes, 2 terrains : les deux premiers tours occupent les deux terrains', () => {
  const event = makeEvent(4);

  const first = ready(event);
  assert.equal(first.length, 2, 'tour 1 : deux rencontres');
  assert.deepEqual(first.map(({ i }) => event.matches[i].court).sort(), [1, 2]);
  assert.equal(new Set(first.flatMap((r) => [r.a, r.b])).size, 4, 'les quatre équipes jouent');

  for (const r of first) setResult(event, r.i, { winner: r.a });

  const second = ready(event);
  assert.equal(second.length, 2, 'tour 2 : finale des gagnants et premier tour des perdants');
  assert.deepEqual(second.map(({ i }) => event.matches[i].side).sort(), ['losers', 'winners']);
  assert.deepEqual(second.map(({ i }) => event.matches[i].court).sort(), [1, 2]);
  assert.equal(new Set(second.flatMap((r) => [r.a, r.b])).size, 4, 'personne ne se repose');
});

test('refuse moins de deux équipes', () => {
  assert.throws(() => createBracket(1), BracketError);
  assert.throws(() => createBracket(0), BracketError);
});

test('l’ordre des équipes est tiré au sort', () => {
  const firstTeam = (seed: number) => {
    const slot = createBracket(8, rng(seed))[0].a;
    return slot !== null && 'team' in slot ? slot.team : -1;
  };
  assert.ok(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(firstTeam)).size > 1);
});

// ---------------------------------------------------------------------------
// La règle : on ne sort qu'à la deuxième défaite
// ---------------------------------------------------------------------------

test('quel que soit le nombre d’équipes et les résultats, on ne sort qu’à la deuxième défaite', () => {
  for (let nTeams = 2; nTeams <= 9; nTeams++) {
    for (let seed = 1; seed <= 12; seed++) {
      const event = makeEvent(nTeams, { seed });
      const random = rng(seed * 97 + nTeams);
      playOut(event, (a, b) => (random() < 0.5 ? a : b));

      const out = outcomes(event.matches);
      const champion = championOf(event.matches, out);
      assert.notEqual(champion, null, `${nTeams} équipes, graine ${seed} : un champion`);
      assert.equal(event.status, 'done');
      assert.equal(event.winner, champion);
      for (let t = 0; t < nTeams; t++) {
        const losses = lossesOf(out, t);
        if (t === champion) assert.ok(losses <= 1, 'le champion a au plus une défaite');
        else assert.equal(losses, 2, `${nTeams} équipes, graine ${seed} : T${t} sort à sa deuxième défaite`);
      }
    }
  }
});

test('une équipe ne joue jamais deux rencontres à la fois, ni contre elle-même', () => {
  for (let nTeams = 2; nTeams <= 9; nTeams++) {
    const event = makeEvent(nTeams, { seed: nTeams, courts: 8 });
    const random = rng(nTeams);
    for (;;) {
      const now = ready(event);
      if (now.length === 0) break;
      const teams = now.flatMap((r) => [r.a, r.b]);
      assert.equal(new Set(teams).size, teams.length, `${nTeams} équipes : pas de doublon simultané`);
      const r = now[Math.floor(random() * now.length)];
      setResult(event, r.i, { winner: random() < 0.5 ? r.a : r.b });
    }
  }
});

test('8 équipes : les battus qui arrivent chez les perdants ne retrouvent pas aussitôt leur ancien adversaire', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const event = makeEvent(8, { seed, courts: 8 });
    const random = rng(seed);
    const met = new Set<string>();
    const key = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);
    for (;;) {
      const now = ready(event);
      if (now.length === 0) break;
      for (const r of now) {
        const m = event.matches[r.i];
        if (m.side === 'losers' && m.round === 1) {
          assert.ok(!met.has(key(r.a, r.b)), `graine ${seed} : revanche immédiate évitée`);
        }
      }
      const r = now[0];
      met.add(key(r.a, r.b));
      setResult(event, r.i, { winner: random() < 0.5 ? r.a : r.b });
    }
  }
});

// ---------------------------------------------------------------------------
// Grande finale
// ---------------------------------------------------------------------------

test('le tableau des gagnants remporte la grande finale : pas de revanche', () => {
  const event = makeEvent(4);
  let finalist = -1;
  playOut(event, (a, b, i) => {
    const m = event.matches[i];
    if (m.side === 'final') {
      const o = outcomes(event.matches)[i];
      finalist = o.a as number; // équipe venue du tableau des gagnants
      return finalist;
    }
    return Math.min(a, b);
  });
  const out = outcomes(event.matches);
  assert.equal(out[6].state, 'skipped');
  assert.equal(championOf(event.matches), finalist);
  assert.equal(lossesOf(out, finalist), 0);
  assert.equal(event.status, 'done');
  assert.deepEqual(progress(event.matches), { played: 6, total: 6 });
});

test('le tableau des perdants remporte la grande finale : revanche, puis champion', () => {
  const event = makeEvent(4);
  // Jusqu'à la grande finale : l'équipe d'index le plus bas gagne.
  for (;;) {
    const next = ready(event)[0];
    if (!next || event.matches[next.i].side === 'final') break;
    setResult(event, next.i, { winner: Math.min(next.a, next.b) });
  }
  const gf = ready(event)[0];
  assert.equal(gf.i, 5);
  const fromWinners = gf.a;
  const fromLosers = gf.b;
  assert.equal(lossesOf(outcomes(event.matches), fromWinners), 0);
  assert.equal(lossesOf(outcomes(event.matches), fromLosers), 1);
  assert.deepEqual(progress(event.matches), { played: 5, total: 6 }, 'la revanche hypothétique ne compte pas');

  setResult(event, 5, { winner: fromLosers });
  assert.equal(event.status, 'running', 'une défaite chacun : ce n’est pas fini');
  assert.equal(championOf(event.matches), null);
  const rematch = ready(event);
  assert.equal(rematch.length, 1);
  assert.equal(rematch[0].i, 6);
  assert.deepEqual(progress(event.matches), { played: 6, total: 7 }, 'la revanche compte dès qu’elle a lieu');

  setResult(event, 6, { winner: fromWinners });
  assert.equal(event.status, 'done');
  assert.equal(event.winner, fromWinners);
  assert.equal(lossesOf(outcomes(event.matches), fromLosers), 2);
});

test('sans revanche : la grande finale est décisive', () => {
  const event = makeEvent(4, { reset: false });
  assert.equal(event.matches.length, 6);
  for (;;) {
    const next = ready(event)[0];
    if (!next || event.matches[next.i].side === 'final') break;
    setResult(event, next.i, { winner: Math.min(next.a, next.b) });
  }
  const gf = ready(event)[0];
  setResult(event, gf.i, { winner: gf.b });
  assert.equal(event.status, 'done');
  assert.equal(event.winner, gf.b);
  const status = teamStatus(event, gf.a);
  assert.deepEqual(status, { kind: 'eliminated', place: 2, losses: 1 });
});

// ---------------------------------------------------------------------------
// Exempts
// ---------------------------------------------------------------------------

test('3 équipes : l’exempt passe sans jouer et le tournoi va au bout', () => {
  const event = makeEvent(3, { seed: 5 });
  const out = outcomes(event.matches);
  const bye = out.findIndex((o) => o.state === 'walkover');
  assert.notEqual(bye, -1);
  assert.throws(() => setResult(event, bye, { winner: out[bye].a as number }), /exemptée/);

  assert.equal(ready(event).length, 1, 'une seule vraie rencontre au premier tour');
  playOut(event, (a, b) => Math.max(a, b));
  assert.equal(event.status, 'done');
});

// ---------------------------------------------------------------------------
// Ce que voit chaque équipe
// ---------------------------------------------------------------------------

test('teamStatus : à jouer, en attente d’adversaire, dans le tableau des perdants, éliminée, championne', () => {
  const event = makeEvent(4);
  const [m0, m1] = ready(event);

  // Tout le monde joue au premier tour, sur un terrain.
  for (const t of [m0.a, m0.b, m1.a, m1.b]) {
    const s = teamStatus(event, t);
    assert.equal(s.kind, 'play');
    assert.ok(s.kind === 'play' && s.court !== null);
  }

  // m0 est joué : le vainqueur attend celui de m1, le battu attend le battu de m1.
  setResult(event, m0.i, { winner: m0.a });
  assert.deepEqual(teamStatus(event, m0.a), {
    kind: 'wait',
    match: 2,
    source: { match: m1.i, take: 'winner' },
    losses: 0,
  });
  assert.deepEqual(teamStatus(event, m0.b), {
    kind: 'wait',
    match: 3,
    source: { match: m1.i, take: 'loser' },
    losses: 1,
  });

  // m1 est joué : le battu de m0 rejoue aussitôt, dans le tableau des perdants.
  setResult(event, m1.i, { winner: m1.a });
  const back = teamStatus(event, m0.b);
  assert.equal(back.kind, 'play');
  assert.ok(back.kind === 'play' && back.opponent === m1.b && event.matches[back.match].side === 'losers');

  // Deuxième défaite : éliminée, dernière place.
  setResult(event, 3, { winner: m1.b });
  assert.deepEqual(teamStatus(event, m0.b), { kind: 'eliminated', place: 4, losses: 2 });

  playOut(event, (a, b) => Math.min(a, b));
  const places = [0, 1, 2, 3].map((t) => {
    const s = teamStatus(event, t);
    return s.kind === 'champion' ? 1 : s.kind === 'eliminated' ? s.place : -1;
  });
  assert.deepEqual([...places].sort(), [1, 2, 3, 4], 'classement final complet et sans ex æquo');
});

test('teamIndexOf : équipe d’un joueur, null pour un spectateur', () => {
  const event = makeEvent(4);
  assert.equal(teamIndexOf(event, 'j2'), 2);
  assert.equal(teamIndexOf(event, 'inconnu'), null);
});

// ---------------------------------------------------------------------------
// Corrections et validation
// ---------------------------------------------------------------------------

test('corriger un vainqueur efface ce qui en dépendait ; corriger un score seul ne touche à rien', () => {
  const event = makeEvent(4);
  const [m0, m1] = ready(event);
  setResult(event, m0.i, { winner: m0.a, sa: 6, sb: 2 });
  setResult(event, m1.i, { winner: m1.a });
  setResult(event, 2, { winner: m0.a }); // finale des gagnants
  setResult(event, 3, { winner: m0.b }); // premier tour des perdants

  // Simple correction de score : la suite reste.
  setResult(event, m0.i, { winner: m0.a, sa: 6, sb: 4 });
  assert.equal(event.matches[2].winner, m0.a);
  assert.equal(event.matches[3].winner, m0.b);

  // Le vainqueur change : finale des gagnants et tour des perdants sont à rejouer.
  setResult(event, m0.i, { winner: m0.b });
  assert.equal(event.matches[2].winner, null);
  assert.equal(event.matches[3].winner, null);
  const out = outcomes(event.matches);
  assert.equal(out[2].state, 'ready');
  assert.equal(out[2].a, m0.b);
  assert.equal(out[3].a, m0.a, 'l’ancien vainqueur passe chez les perdants');
});

test('validation : rencontre non prête, égalité, négatif, score partiel, vainqueur étranger, contradiction, index inconnu, match non lancé', () => {
  const event = makeEvent(4);
  const [m0] = ready(event);
  const errors: Array<[() => unknown, RegExp]> = [
    [() => setResult(event, 2, { winner: 0 }), /pas encore connues/],
    [() => setResult(event, m0.i, { sa: 3, sb: 3 }), /Égalité/],
    [() => setResult(event, m0.i, { sa: -1, sb: 2 }), /positifs/],
    [() => setResult(event, m0.i, { sa: 3 }), /deux scores/],
    [() => setResult(event, m0.i, {}), /qui a gagné/],
    [() => setResult(event, m0.i, { winner: 99 }), /l’une des deux équipes/],
    [() => setResult(event, m0.i, { winner: m0.a, sa: 1, sb: 6 }), /contredit/],
    [() => setResult(event, 42, { winner: 0 }), /inconnue/],
    [() => setResult({ ...event, status: 'open' }, m0.i, { winner: m0.a }), /pas encore été lancé/],
  ];
  for (const [fn, message] of errors) assert.throws(fn, message);

  // Revanche inutile : la déclarer est refusé.
  playOut(event, (a, b, i) => (event.matches[i].side === 'final' ? (outcomes(event.matches)[i].a as number) : a));
  assert.throws(() => setResult(event, 6, { winner: 0 }), /revanche/);
});

test('vainqueur et score concordants sont acceptés ensemble', () => {
  const event = makeEvent(4);
  const [m0] = ready(event);
  setResult(event, m0.i, { winner: m0.b, sa: 2, sb: 6 });
  assert.equal(event.matches[m0.i].winner, m0.b);
});

// ---------------------------------------------------------------------------
// Terrains
// ---------------------------------------------------------------------------

test('terrains : jamais plus de rencontres que de terrains, et personne ne change de terrain en cours de match', () => {
  for (const courts of [1, 2, 3]) {
    const event = makeEvent(8, { seed: courts, courts });
    const random = rng(courts);
    const seen = new Map<number, number>(); // rencontre → terrain attribué
    for (;;) {
      const now = ready(event);
      if (now.length === 0) break;
      const assigned = now.filter(({ i }) => event.matches[i].court !== null);
      const numbers = assigned.map(({ i }) => event.matches[i].court);
      assert.ok(assigned.length <= courts, `${courts} terrain(s) : pas de surréservation`);
      assert.equal(new Set(numbers).size, numbers.length, 'deux rencontres jamais sur le même terrain');
      assert.equal(assigned.length, Math.min(courts, now.length), 'aucun terrain libre laissé vide');
      for (const { i } of assigned) {
        const court = event.matches[i].court as number;
        if (seen.has(i)) assert.equal(seen.get(i), court, 'terrain stable');
        seen.set(i, court);
      }
      // On termine en priorité une rencontre qui a un terrain, comme dans la vraie vie.
      const r = assigned[Math.floor(random() * assigned.length)];
      setResult(event, r.i, { winner: random() < 0.5 ? r.a : r.b });
    }
  }
});

test('libellés des rencontres', () => {
  const event = makeEvent(8);
  const labels = new Set(event.matches.map((_, i) => matchLabel(event.matches, i)));
  for (const label of [
    'Gagnants · tour 1',
    'Gagnants · tour 2',
    'Finale des gagnants',
    'Perdants · tour 1',
    'Finale des perdants',
    'Grande finale',
    'Revanche de la grande finale',
  ]) {
    assert.ok(labels.has(label), label);
  }
});
