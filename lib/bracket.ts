/**
 * Tableau à élimination directe.
 *
 * - Taille du tableau = puissance de 2 ≥ nombre d'équipes ; les places manquantes
 *   sont des exempts (`b: null`), au plus un par rencontre, répartis pour que
 *   deux exemptés ne se retrouvent pas face à face au tour suivant.
 * - Une rencontre sans adversaire est gagnée d'office.
 * - Le résultat d'une rencontre est un vainqueur déclaré (`winner`), avec un
 *   score facultatif. Égalité interdite.
 * - `advance` génère le tour suivant dès que toutes les rencontres du dernier
 *   tour ont un vainqueur ; s'il ne reste qu'un vainqueur, le match est terminé.
 * - Corriger un résultat qui change le vainqueur d'un tour antérieur supprime
 *   les tours suivants, qui sont recalculés.
 */
import type { Match, MatchEvent } from './types.ts';

export class BracketError extends Error {
  name = 'BracketError';
}

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function newMatch(a: number, b: number | null): Match {
  return { a, b, winner: null, sa: null, sb: null };
}

/**
 * Premier tour du tableau pour `nTeams` équipes (index 0..nTeams-1).
 * L'ordre des équipes est tiré au sort.
 */
export function createFirstRound(nTeams: number, rng: () => number = Math.random): Match[] {
  if (!Number.isInteger(nTeams) || nTeams < 2) {
    throw new BracketError('Il faut au moins deux équipes pour un tableau.');
  }
  const size = nextPowerOfTwo(nTeams);
  const nMatches = size / 2;
  const nByes = size - nTeams; // toujours < nMatches, donc au plus un exempt par rencontre

  const order = shuffle(Array.from({ length: nTeams }, (_, i) => i), rng);

  // Rencontres qui reçoivent un exempt : d'abord les paires (0, 2, 4…), puis les
  // impaires, pour que les exemptés soient dispersés dans le tableau.
  const candidates: number[] = [];
  for (let m = 0; m < nMatches; m += 2) candidates.push(m);
  for (let m = 1; m < nMatches; m += 2) candidates.push(m);
  const byeSlots = new Set(candidates.slice(0, nByes));

  const round: Match[] = [];
  let k = 0;
  for (let m = 0; m < nMatches; m++) {
    const a = order[k++];
    const b = byeSlots.has(m) ? null : order[k++];
    round.push(newMatch(a, b));
  }
  return round;
}

/**
 * Vainqueur d'une rencontre (index d'équipe), ou null si pas encore jouée.
 * Un exempt gagne d'office ; à défaut de vainqueur déclaré, un score complet
 * fait foi (compatibilité avec les anciennes archives).
 */
export function winnerOf(match: Match): number | null {
  if (match.b === null) return match.a;
  if (typeof match.winner === 'number') return match.winner;
  if (match.sa !== null && match.sb !== null && match.sa !== match.sb) {
    return match.sa > match.sb ? match.a : match.b;
  }
  return null;
}

/** Nombre total de tours du tableau (finale comprise). */
export function totalRounds(event: Pick<MatchEvent, 'rounds'>): number {
  const first = event.rounds[0];
  if (!first || first.length === 0) return 0;
  return Math.round(Math.log2(first.length)) + 1;
}

/** Libellé d'un tour : « Finale », « Demi-finales », « Quarts de finale », « Tour n ». */
export function roundLabel(index: number, total: number): string {
  const fromEnd = total - 1 - index;
  if (fromEnd === 0) return 'Finale';
  if (fromEnd === 1) return 'Demi-finales';
  if (fromEnd === 2) return 'Quarts de finale';
  return `Tour ${index + 1}`;
}

/** Index de l'équipe d'un joueur, ou null s'il ne joue pas (remplaçant, absent). */
export function teamIndexOf(event: Pick<MatchEvent, 'teams'>, playerId: string): number | null {
  const index = event.teams.findIndex((t) => t.members.some((m) => m.id === playerId));
  return index >= 0 ? index : null;
}

export interface LocatedMatch {
  round: number;
  index: number;
  match: Match;
}

/** Dernière rencontre (la plus avancée dans le tableau) où joue une équipe. */
export function latestMatchOf(event: Pick<MatchEvent, 'rounds'>, teamIndex: number): LocatedMatch | null {
  for (let round = event.rounds.length - 1; round >= 0; round--) {
    const index = event.rounds[round].findIndex((m) => m.a === teamIndex || m.b === teamIndex);
    if (index >= 0) return { round, index, match: event.rounds[round][index] };
  }
  return null;
}

/**
 * Fait progresser le tableau autant que possible : tant que le dernier tour est
 * complet, on génère le suivant en appariant les vainqueurs dans l'ordre.
 * Quand il ne reste qu'un vainqueur, le match passe en `done`.
 */
export function advance(event: MatchEvent): MatchEvent {
  for (;;) {
    const last = event.rounds[event.rounds.length - 1];
    if (!last) return event;
    const winners = last.map(winnerOf);
    if (winners.some((w) => w === null)) return event;
    const ids = winners as number[];
    if (ids.length === 1) {
      event.status = 'done';
      event.winner = ids[0];
      return event;
    }
    const next: Match[] = [];
    for (let i = 0; i < ids.length; i += 2) {
      next.push(newMatch(ids[i], ids[i + 1] ?? null));
    }
    event.rounds.push(next);
  }
}

export interface MatchResult {
  /** Index de l'équipe gagnante. Facultatif si un score complet est fourni. */
  winner?: number | null;
  sa?: number | null;
  sb?: number | null;
}

/**
 * Déclare (ou corrige) le résultat d'une rencontre puis recalcule la suite.
 * On peut donner seulement le vainqueur, seulement le score (le vainqueur en
 * découle), ou les deux (ils doivent concorder).
 * Si le vainqueur de la rencontre change, les tours suivants sont supprimés et
 * regénérés ; sinon ils sont conservés (simple correction de score).
 */
export function setResult(event: MatchEvent, round: number, match: number, result: MatchResult): MatchEvent {
  if (event.status === 'open') throw new BracketError('Le match n’a pas encore été lancé.');
  const r = event.rounds[round];
  if (!r) throw new BracketError('Tour inconnu.');
  const m = r[match];
  if (!m) throw new BracketError('Rencontre inconnue.');
  if (m.b === null) throw new BracketError('Cette équipe est exemptée : rien à déclarer.');

  const sa = result.sa ?? null;
  const sb = result.sb ?? null;
  if ((sa === null) !== (sb === null)) throw new BracketError('Indique les deux scores, ou aucun.');
  let byScore: number | null = null;
  if (sa !== null && sb !== null) {
    if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) {
      throw new BracketError('Les scores doivent être des entiers positifs ou nuls.');
    }
    if (sa === sb) throw new BracketError('Égalité interdite : il faut un vainqueur.');
    byScore = sa > sb ? m.a : m.b;
  }

  const winner = result.winner ?? byScore;
  if (winner === null || winner === undefined) throw new BracketError('Indique l’équipe qui a gagné.');
  if (winner !== m.a && winner !== m.b) {
    throw new BracketError('Le vainqueur doit être l’une des deux équipes de la rencontre.');
  }
  if (byScore !== null && byScore !== winner) {
    throw new BracketError('Le score contredit le vainqueur indiqué.');
  }

  const before = winnerOf(m);
  m.winner = winner;
  m.sa = sa;
  m.sb = sb;

  if (before !== winner) {
    event.rounds.length = round + 1;
    event.status = 'running';
    event.winner = null;
    advance(event);
  }
  return event;
}
