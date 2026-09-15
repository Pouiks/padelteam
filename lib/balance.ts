/**
 * Équilibrage des équipes.
 *
 * 1. nTeams = floor(participants / teamSize) ; il en faut au moins deux.
 * 2. Les nTeams × teamSize premiers inscrits jouent, les suivants sont remplaçants.
 * 3. Tri par niveau décroissant puis draft serpentin (1→N, N→1, 1→N, …).
 * 4. Amélioration par échanges aléatoires entre équipes : un échange est gardé
 *    s'il réduit l'écart max(somme des niveaux) − min(somme des niveaux).
 * 5. Mélange de l'ordre des équipes puis attribution des noms de couleurs.
 */
import type { Participant, Team } from './types.ts';

export const TEAM_NAMES = [
  'Rouges',
  'Bleus',
  'Verts',
  'Jaunes',
  'Noirs',
  'Blancs',
  'Orange',
  'Violets',
  'Gris',
  'Roses',
  'Cyan',
  'Bruns',
] as const;

/** Nombre d'échanges aléatoires tentés après le draft serpentin. */
export const SWAP_ITERATIONS = 600;

export class BalanceError extends Error {
  name = 'BalanceError';
}

export interface BalanceResult {
  teams: Team[];
  subs: Participant[];
}

/** Somme des niveaux d'une équipe. */
export function teamSum(members: Participant[]): number {
  return members.reduce((total, p) => total + p.level, 0);
}

/** Écart entre l'équipe la plus forte et la plus faible. */
export function spread(teams: Array<{ members: Participant[] }>): number {
  const sums = teams.map((t) => teamSum(t.members));
  return Math.max(...sums) - Math.min(...sums);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Forme des équipes équilibrées.
 * @param participants inscrits, dans l'ordre d'inscription
 * @param teamSize     joueurs par équipe
 * @param rng          générateur pseudo-aléatoire (injectable pour les tests)
 */
export function balance(
  participants: Participant[],
  teamSize: number,
  rng: () => number = Math.random,
): BalanceResult {
  if (!Number.isInteger(teamSize) || teamSize < 1) {
    throw new BalanceError('La taille des équipes doit être un entier positif.');
  }
  const nTeams = Math.floor(participants.length / teamSize);
  if (nTeams < 2) {
    throw new BalanceError(
      `Il faut au moins ${2 * teamSize} inscrits pour former deux équipes de ${teamSize}.`,
    );
  }

  // Étape 2 : titulaires et remplaçants, dans l'ordre d'inscription.
  const playing = participants.slice(0, nTeams * teamSize);
  const subs = participants.slice(nTeams * teamSize);

  // Étape 3 : draft serpentin sur les joueurs triés du plus fort au plus faible.
  const sorted = [...playing].sort((a, b) => b.level - a.level);
  const teams: Participant[][] = Array.from({ length: nTeams }, () => []);
  sorted.forEach((player, i) => {
    const pass = Math.floor(i / nTeams);
    const pos = i % nTeams;
    const t = pass % 2 === 0 ? pos : nTeams - 1 - pos;
    teams[t].push(player);
  });

  // Étape 4 : recherche locale par échanges aléatoires de deux joueurs.
  const sums = teams.map(teamSum);
  let currentSpread = Math.max(...sums) - Math.min(...sums);
  for (let it = 0; it < SWAP_ITERATIONS && currentSpread > 0; it++) {
    const t1 = Math.floor(rng() * nTeams);
    const t2 = Math.floor(rng() * nTeams);
    if (t1 === t2) continue;
    const i1 = Math.floor(rng() * teamSize);
    const i2 = Math.floor(rng() * teamSize);
    const delta = teams[t2][i2].level - teams[t1][i1].level;
    if (delta === 0) continue;
    const next = [...sums];
    next[t1] += delta;
    next[t2] -= delta;
    const nextSpread = Math.max(...next) - Math.min(...next);
    if (nextSpread < currentSpread) {
      [teams[t1][i1], teams[t2][i2]] = [teams[t2][i2], teams[t1][i1]];
      sums[t1] = next[t1];
      sums[t2] = next[t2];
      currentSpread = nextSpread;
    }
  }

  // Étape 5 : ordre des équipes tiré au sort, puis noms de couleurs.
  shuffle(teams, rng);
  return {
    teams: teams.map((members, i) => ({
      name: TEAM_NAMES[i % TEAM_NAMES.length],
      members,
    })),
    subs,
  };
}
