/** Tests du tableau à élimination directe (node --test). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advance,
  BracketError,
  createFirstRound,
  latestMatchOf,
  roundLabel,
  setResult,
  teamIndexOf,
  totalRounds,
  winnerOf,
} from '../lib/bracket.ts';
import type { Match, MatchEvent } from '../lib/types.ts';

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

/** Match lancé avec `nTeams` équipes d'un joueur (« j0 », « j1 », …). */
function makeEvent(nTeams: number, seed = 1): MatchEvent {
  const event: MatchEvent = {
    title: 'test',
    teamSize: 1,
    createdBy: 'p',
    createdAt: new Date(0).toISOString(),
    status: 'running',
    participants: [],
    teams: Array.from({ length: nTeams }, (_, i) => ({
      name: `T${i}`,
      members: [{ id: `j${i}`, name: `Joueur ${i}`, level: 3 }],
    })),
    subs: [],
    rounds: [createFirstRound(nTeams, rng(seed))],
    winner: null,
  };
  return advance(event);
}

/** Vainqueur d'une rencontre selon un score, pratique pour écrire les tests. */
function score(event: MatchEvent, round: number, match: number, sa: number, sb: number): MatchEvent {
  return setResult(event, round, match, { sa, sb });
}

test('2 équipes : une seule rencontre, pas d’exempt', () => {
  const round = createFirstRound(2, rng(1));
  assert.equal(round.length, 1);
  assert.notEqual(round[0].b, null);
  assert.deepEqual([round[0].a, round[0].b].sort(), [0, 1]);
  assert.equal(round[0].winner, null);
});

test('3 équipes : tableau de 4, un exempt, chaque équipe placée une fois', () => {
  const round = createFirstRound(3, rng(1));
  assert.equal(round.length, 2);
  assert.equal(round.filter((m) => m.b === null).length, 1);
  const ids = round.flatMap((m) => [m.a, m.b]).filter((x) => x !== null).sort();
  assert.deepEqual(ids, [0, 1, 2]);
});

test('5 équipes : tableau de 8, trois exempts, au plus un par rencontre', () => {
  const round = createFirstRound(5, rng(3));
  assert.equal(round.length, 4);
  assert.equal(round.filter((m) => m.b === null).length, 3);
  const ids = round.flatMap((m) => [m.a, m.b]).filter((x) => x !== null).sort();
  assert.deepEqual(ids, [0, 1, 2, 3, 4]);
});

test('6 équipes : les deux exemptés ne se rencontrent pas au tour suivant', () => {
  const round = createFirstRound(6, rng(2));
  const byeIndexes = round.map((m, i) => (m.b === null ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(byeIndexes, [0, 2]);
});

test('l’ordre des équipes est tiré au sort', () => {
  const a = createFirstRound(8, rng(1)).map((m) => `${m.a}-${m.b}`).join(',');
  const b = createFirstRound(8, rng(99)).map((m) => `${m.a}-${m.b}`).join(',');
  assert.notEqual(a, b);
});

test('winnerOf : exempt, vainqueur déclaré, score seul (anciennes archives), rien', () => {
  assert.equal(winnerOf({ a: 4, b: null, winner: null, sa: null, sb: null }), 4);
  assert.equal(winnerOf({ a: 1, b: 2, winner: 2, sa: null, sb: null }), 2);
  assert.equal(winnerOf({ a: 1, b: 2, sa: 3, sb: 5 } as unknown as Match), 2);
  assert.equal(winnerOf({ a: 1, b: 2, winner: null, sa: null, sb: null }), null);
});

test('déclarer le vainqueur sans score suffit à faire avancer le tableau', () => {
  const event = makeEvent(4);
  setResult(event, 0, 0, { winner: event.rounds[0][0].a });
  setResult(event, 0, 1, { winner: event.rounds[0][1].b });
  assert.equal(event.rounds.length, 2);
  assert.equal(event.rounds[0][0].sa, null);
  const final = event.rounds[1][0];
  assert.equal(final.a, event.rounds[0][0].a);
  assert.equal(final.b, event.rounds[0][1].b);
  setResult(event, 1, 0, { winner: final.b });
  assert.equal(event.status, 'done');
  assert.equal(event.winner, final.b);
});

test('avancement par scores : 4 équipes → demi-finales puis finale, puis vainqueur', () => {
  const event = makeEvent(4);
  assert.equal(totalRounds(event), 2);
  assert.equal(event.rounds.length, 1);

  score(event, 0, 0, 3, 1);
  assert.equal(event.rounds.length, 1, 'le tour suivant attend toutes les rencontres');
  assert.equal(event.rounds[0][0].winner, event.rounds[0][0].a, 'le vainqueur découle du score');

  score(event, 0, 1, 0, 2);
  assert.equal(event.rounds.length, 2);
  const final = event.rounds[1][0];
  assert.equal(final.a, event.rounds[0][0].a);
  assert.equal(final.b, event.rounds[0][1].b);
  assert.equal(event.status, 'running');

  score(event, 1, 0, 5, 4);
  assert.equal(event.status, 'done');
  assert.equal(event.winner, final.a);
});

test('3 équipes : l’exemptée attend directement en finale', () => {
  const event = makeEvent(3);
  const bye = event.rounds[0].find((m) => m.b === null)!;
  const real = event.rounds[0].findIndex((m) => m.b !== null);
  score(event, 0, real, 1, 0);
  assert.equal(event.rounds.length, 2);
  const final = event.rounds[1][0];
  assert.ok([final.a, final.b].includes(bye.a));
  assert.ok([final.a, final.b].includes(event.rounds[0][real].a));
});

test('validation : égalité, négatif, score partiel, vainqueur étranger, score contradictoire, exempt, index inconnus, match non lancé', () => {
  const event = makeEvent(4);
  const real = event.rounds[0].findIndex((m) => m.b !== null);
  const m = event.rounds[0][real];
  assert.throws(() => score(event, 0, real, 2, 2), BracketError);
  assert.throws(() => score(event, 0, real, -1, 2), BracketError);
  assert.throws(() => score(event, 0, real, 1.5, 2), BracketError);
  assert.throws(() => setResult(event, 0, real, { sa: 1 }), BracketError);
  assert.throws(() => setResult(event, 0, real, {}), BracketError);
  assert.throws(() => setResult(event, 0, real, { winner: 99 }), BracketError);
  assert.throws(() => setResult(event, 0, real, { winner: m.a, sa: 0, sb: 3 }), BracketError);
  assert.throws(() => setResult(event, 5, 0, { winner: 0 }), BracketError);
  assert.throws(() => setResult(event, 0, 9, { winner: 0 }), BracketError);
  const withBye = makeEvent(3);
  const byeIndex = withBye.rounds[0].findIndex((mm) => mm.b === null);
  assert.throws(() => setResult(withBye, 0, byeIndex, { winner: withBye.rounds[0][byeIndex].a }), BracketError);
  const open = { ...makeEvent(4), status: 'open' as const };
  assert.throws(() => setResult(open, 0, 0, { winner: 0 }), BracketError);
  assert.equal(event.rounds.length, 1, 'rien n’a bougé');
});

test('vainqueur et score concordants sont acceptés ensemble', () => {
  const event = makeEvent(2);
  const m = event.rounds[0][0];
  setResult(event, 0, 0, { winner: m.b as number, sa: 2, sb: 6 });
  assert.equal(event.status, 'done');
  assert.equal(event.winner, m.b);
  assert.equal(m.sa, 2);
});

test('corriger un résultat qui change le vainqueur efface et recalcule la suite', () => {
  const event = makeEvent(4);
  score(event, 0, 0, 3, 1);
  score(event, 0, 1, 2, 0);
  score(event, 1, 0, 1, 0);
  assert.equal(event.status, 'done');
  const oldFinalist = event.rounds[1][0].a;

  setResult(event, 0, 0, { winner: event.rounds[0][0].b as number }); // l'autre équipe gagne finalement
  assert.equal(event.status, 'running');
  assert.equal(event.winner, null);
  assert.equal(event.rounds.length, 2, 'la finale est regénérée');
  assert.equal(event.rounds[1][0].a, event.rounds[0][0].b);
  assert.notEqual(event.rounds[1][0].a, oldFinalist);
  assert.equal(event.rounds[1][0].winner, null);
  assert.equal(event.rounds[0][0].sa, null, 'l’ancien score est effacé');
});

test('corriger un score sans changer le vainqueur conserve la suite', () => {
  const event = makeEvent(4);
  score(event, 0, 0, 3, 1);
  score(event, 0, 1, 2, 0);
  score(event, 1, 0, 1, 0);
  score(event, 0, 0, 4, 1);
  assert.equal(event.status, 'done');
  assert.equal(event.rounds[1][0].sa, 1);
  assert.equal(event.rounds[0][0].sa, 4);
});

test('teamIndexOf et latestMatchOf : suivre son équipe jusqu’à la finale', () => {
  const event = makeEvent(4);
  assert.equal(teamIndexOf(event, 'j2'), 2);
  assert.equal(teamIndexOf(event, 'inconnu'), null);

  const first = latestMatchOf(event, 2)!;
  assert.equal(first.round, 0);
  assert.ok([first.match.a, first.match.b].includes(2));

  score(event, 0, 0, 3, 1);
  score(event, 0, 1, 3, 1);
  const finalists = [event.rounds[1][0].a, event.rounds[1][0].b];
  for (const team of [0, 1, 2, 3]) {
    const located = latestMatchOf(event, team)!;
    assert.equal(located.round, finalists.includes(team) ? 1 : 0);
  }
});

test('libellés des tours', () => {
  assert.equal(roundLabel(0, 1), 'Finale');
  assert.equal(roundLabel(0, 2), 'Demi-finales');
  assert.equal(roundLabel(1, 2), 'Finale');
  assert.equal(roundLabel(0, 3), 'Quarts de finale');
  assert.equal(roundLabel(0, 4), 'Tour 1');
  assert.equal(roundLabel(1, 4), 'Quarts de finale');
  assert.equal(roundLabel(3, 4), 'Finale');
});

test('totalRounds : 8 équipes → 3 tours, 5 équipes → 3 tours, 2 équipes → 1 tour', () => {
  assert.equal(totalRounds(makeEvent(8)), 3);
  assert.equal(totalRounds(makeEvent(5)), 3);
  assert.equal(totalRounds(makeEvent(2)), 1);
  assert.equal(totalRounds({ rounds: [] }), 0);
});
