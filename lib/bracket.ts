/**
 * Tournoi à double élimination.
 *
 * Personne ne sort sur une seule défaite : l'équipe battue dans le tableau des
 * gagnants bascule dans celui des perdants, et n'est éliminée qu'à sa deuxième
 * défaite. Le vainqueur du tableau des gagnants retrouve celui du tableau des
 * perdants en grande finale ; si ce dernier gagne, les deux équipes comptent
 * une défaite chacune et une revanche les départage.
 *
 * Le tableau est un graphe fixé au lancement : chaque rencontre dit où chercher
 * ses deux équipes (tirage, vainqueur ou perdant d'une autre rencontre, ou place
 * vide pour un exempt). Les rencontres sont rangées de sorte que leurs sources
 * les précèdent toujours, ce qui permet de tout résoudre en une passe. On ne
 * stocke que les résultats déclarés : qui joue, qui attend et qui est éliminé se
 * recalculent à la demande.
 *
 * Avec 4 équipes et 2 terrains :
 *   tour 1   gagnants A–B        gagnants C–D
 *   tour 2   finale gagnants     perdants (battus du tour 1)
 *   tour 3   finale perdants     (battu de la finale gagnants contre le rescapé)
 *   tour 4   grande finale       (+ revanche si le tableau des perdants la gagne)
 */
import type { BracketMatch, BracketSide, MatchEvent, Slot } from './types.ts';

export class BracketError extends Error {
  name = 'BracketError';
}

/** Occupant d'une place : une équipe, pas encore connu, ou personne pour de bon. */
export type Resolved = number | 'pending' | 'empty';

/**
 * État d'une rencontre :
 *  - pending  : au moins une équipe n'est pas encore connue ;
 *  - ready    : les deux équipes sont connues, résultat à déclarer ;
 *  - done     : résultat déclaré ;
 *  - walkover : une place est vide, l'autre équipe passe sans jouer ;
 *  - skipped  : revanche de grande finale inutile.
 */
export type MatchState = 'pending' | 'ready' | 'done' | 'walkover' | 'skipped';

export interface Outcome {
  state: MatchState;
  a: Resolved;
  b: Resolved;
  winner: Resolved;
  loser: Resolved;
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

const winnerOfMatch = (from: number): Slot => ({ from, take: 'winner' });
const loserOfMatch = (from: number): Slot => ({ from, take: 'loser' });

function blank(side: BracketSide, round: number, a: Slot, b: Slot): BracketMatch {
  return { side, round, stage: 0, a, b, winner: null, sa: null, sb: null, court: null };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface BracketOptions {
  /** Revanche si l'équipe du tableau des perdants gagne la grande finale (par défaut : oui). */
  reset?: boolean;
}

/**
 * Construit le tableau complet pour `nTeams` équipes (index 0..nTeams-1).
 * L'ordre des équipes est tiré au sort ; s'il manque des équipes pour remplir
 * une puissance de deux, les exempts sont dispersés pour que deux exemptés ne
 * se retrouvent pas face à face au tour suivant.
 */
export function createBracket(
  nTeams: number,
  rng: () => number = Math.random,
  { reset = true }: BracketOptions = {},
): BracketMatch[] {
  if (!Number.isInteger(nTeams) || nTeams < 2) {
    throw new BracketError('Il faut au moins deux équipes pour un tableau.');
  }
  const size = nextPowerOfTwo(nTeams);
  const depth = Math.round(Math.log2(size)); // tours du tableau des gagnants
  const matches: BracketMatch[] = [];
  const add = (m: BracketMatch) => matches.push(m) - 1;

  // --- Tableau des gagnants ------------------------------------------------
  const order = shuffle(Array.from({ length: nTeams }, (_, i) => i), rng);
  const firstCount = size / 2;
  const byes = size - nTeams; // toujours < firstCount : au plus un exempt par rencontre
  const byeCandidates: number[] = [];
  for (let m = 0; m < firstCount; m += 2) byeCandidates.push(m);
  for (let m = 1; m < firstCount; m += 2) byeCandidates.push(m);
  const byeSlots = new Set(byeCandidates.slice(0, byes));

  const winners: number[][] = [[]];
  let next = 0;
  for (let m = 0; m < firstCount; m++) {
    const a: Slot = { team: order[next++] };
    const b: Slot = byeSlots.has(m) ? null : { team: order[next++] };
    winners[0].push(add(blank('winners', 0, a, b)));
  }
  for (let r = 1; r < depth; r++) {
    const prev = winners[r - 1];
    winners[r] = [];
    for (let j = 0; j < prev.length; j += 2) {
      winners[r].push(add(blank('winners', r, winnerOfMatch(prev[j]), winnerOfMatch(prev[j + 1]))));
    }
  }

  // --- Tableau des perdants ------------------------------------------------
  let losersChampion: Slot;
  if (depth === 1) {
    // Deux équipes : le battu du seul match retrouve directement le vainqueur.
    losersChampion = loserOfMatch(winners[0][0]);
  } else {
    let lr = 0;
    let current: number[] = [];
    const firstLosers = winners[0];
    for (let j = 0; j < firstLosers.length; j += 2) {
      current.push(add(blank('losers', lr, loserOfMatch(firstLosers[j]), loserOfMatch(firstLosers[j + 1]))));
    }
    lr++;
    for (let r = 1; r < depth; r++) {
      // Tour « d'accueil » : les rescapés reçoivent les battus du tour r des
      // gagnants, pris dans l'ordre inverse pour ne pas rejouer aussitôt
      // l'équipe déjà rencontrée.
      const dropped = winners[r];
      current = current.map((m, j) =>
        add(blank('losers', lr, winnerOfMatch(m), loserOfMatch(dropped[dropped.length - 1 - j]))),
      );
      lr++;
      if (r < depth - 1) {
        // Tour interne : les rescapés s'affrontent entre eux.
        const paired: number[] = [];
        for (let j = 0; j < current.length; j += 2) {
          paired.push(add(blank('losers', lr, winnerOfMatch(current[j]), winnerOfMatch(current[j + 1]))));
        }
        current = paired;
        lr++;
      }
    }
    losersChampion = winnerOfMatch(current[0]);
  }

  // --- Grande finale -------------------------------------------------------
  const final = add(blank('final', 0, winnerOfMatch(winners[depth - 1][0]), losersChampion));
  if (reset) {
    const rematch = blank('final', 1, winnerOfMatch(final), loserOfMatch(final));
    rematch.reset = true;
    add(rematch);
  }

  // Tour de jeu : une rencontre suit la plus tardive de ses sources.
  for (const m of matches) {
    const after = [m.a, m.b].map((s) => (s !== null && 'from' in s ? matches[s.from].stage + 1 : 0));
    m.stage = Math.max(...after);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

/** Issue de chaque rencontre, dans l'ordre du tableau (les sources précèdent toujours). */
export function outcomes(matches: BracketMatch[]): Outcome[] {
  const out: Outcome[] = [];
  const resolve = (slot: Slot): Resolved => {
    if (slot === null) return 'empty';
    if ('team' in slot) return slot.team;
    return out[slot.from]?.[slot.take] ?? 'empty';
  };

  for (const m of matches) {
    const a = resolve(m.a);
    const b = resolve(m.b);

    if (m.reset && m.a !== null && 'from' in m.a) {
      const first = out[m.a.from];
      if (first.state !== 'done') {
        out.push({ state: 'pending', a, b, winner: 'pending', loser: 'pending' });
        continue;
      }
      // L'équipe du tableau des gagnants a gagné la grande finale : c'est fini.
      if (first.winner === first.a) {
        out.push({ state: 'skipped', a, b, winner: 'empty', loser: 'empty' });
        continue;
      }
    }

    if (a === 'empty' || b === 'empty') {
      out.push({ state: 'walkover', a, b, winner: a === 'empty' ? b : a, loser: 'empty' });
    } else if (a === 'pending' || b === 'pending') {
      out.push({ state: 'pending', a, b, winner: 'pending', loser: 'pending' });
    } else if (m.winner === a || m.winner === b) {
      out.push({ state: 'done', a, b, winner: m.winner, loser: m.winner === a ? b : a });
    } else {
      out.push({ state: 'ready', a, b, winner: 'pending', loser: 'pending' });
    }
  }
  return out;
}

/** Équipe championne, ou null tant que la dernière finale utile n'est pas jouée. */
export function championOf(matches: BracketMatch[], out: Outcome[] = outcomes(matches)): number | null {
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].side !== 'final' || out[i].state === 'skipped') continue;
    const { state, winner } = out[i];
    return (state === 'done' || state === 'walkover') && typeof winner === 'number' ? winner : null;
  }
  return null;
}

/** Nombre de défaites d'une équipe. */
export function lossesOf(out: Outcome[], team: number): number {
  return out.filter((o) => o.state === 'done' && o.loser === team).length;
}

// ---------------------------------------------------------------------------
// Déclaration des résultats
// ---------------------------------------------------------------------------

export interface MatchResult {
  /** Index de l'équipe gagnante. Facultatif si un score complet est fourni. */
  winner?: number | null;
  sa?: number | null;
  sb?: number | null;
}

/** Efface les résultats et terrains de tout ce qui dépend de la rencontre `index`. */
function clearDependents(matches: BracketMatch[], index: number): void {
  const affected = new Set([index]);
  for (let i = index + 1; i < matches.length; i++) {
    const m = matches[i];
    if ([m.a, m.b].some((s) => s !== null && 'from' in s && affected.has(s.from))) {
      affected.add(i);
      m.winner = null;
      m.sa = null;
      m.sb = null;
      m.court = null;
    }
  }
}

/**
 * Attribue un terrain aux rencontres prêtes qui n'en ont pas, sans toucher aux
 * terrains déjà donnés : personne ne change de terrain parce qu'une autre
 * rencontre s'est terminée. Les rencontres les plus anciennes du tableau passent
 * en premier ; au-delà du nombre de terrains, elles attendent qu'un se libère.
 * Une rencontre jouée garde son terrain (pour mémoire) mais ne l'occupe plus.
 */
export function assignCourts(event: Pick<MatchEvent, 'matches' | 'courts'>, out = outcomes(event.matches)): void {
  // Les rencontres sont déjà rangées par index : un tri stable par tour suffit.
  const ready: BracketMatch[] = [];
  event.matches.forEach((m, i) => {
    if (out[i].state === 'ready') ready.push(m);
    else if (out[i].state !== 'done') m.court = null;
  });
  ready.sort((x, y) => x.stage - y.stage);

  const used = new Set<number>();
  for (const m of ready) {
    if (m.court !== null && m.court >= 1 && m.court <= event.courts && !used.has(m.court)) used.add(m.court);
    else m.court = null;
  }
  for (const m of ready) {
    if (m.court !== null) continue;
    for (let c = 1; c <= event.courts; c++) {
      if (!used.has(c)) {
        m.court = c;
        used.add(c);
        break;
      }
    }
  }
}

/** Met à jour statut, champion et terrains après une modification du tableau. */
export function settle(event: MatchEvent): MatchEvent {
  const out = outcomes(event.matches);
  const champion = championOf(event.matches, out);
  event.winner = champion;
  event.status = champion === null ? 'running' : 'done';
  assignCourts(event, out);
  return event;
}

/**
 * Déclare (ou corrige) le résultat d'une rencontre. On peut donner seulement le
 * vainqueur, seulement le score (le vainqueur en découle), ou les deux (ils
 * doivent concorder). Si le vainqueur change, tout ce qui en dépendait est
 * effacé ; une simple correction de score ne touche à rien d'autre.
 */
export function setResult(event: MatchEvent, index: number, result: MatchResult): MatchEvent {
  if (event.status === 'open') throw new BracketError('Le match n’a pas encore été lancé.');
  const m = event.matches[index];
  if (!m) throw new BracketError('Rencontre inconnue.');
  const o = outcomes(event.matches)[index];
  if (o.state === 'walkover') throw new BracketError('Cette équipe est exemptée : rien à déclarer.');
  if (o.state === 'skipped') throw new BracketError('Cette revanche n’a pas lieu : la finale est déjà gagnée.');
  if (o.state === 'pending') {
    throw new BracketError('Les deux équipes de cette rencontre ne sont pas encore connues.');
  }
  const a = o.a as number;
  const b = o.b as number;

  const sa = result.sa ?? null;
  const sb = result.sb ?? null;
  if ((sa === null) !== (sb === null)) throw new BracketError('Indique les deux scores, ou aucun.');
  let byScore: number | null = null;
  if (sa !== null && sb !== null) {
    if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) {
      throw new BracketError('Les scores doivent être des entiers positifs ou nuls.');
    }
    if (sa === sb) throw new BracketError('Égalité interdite : il faut un vainqueur.');
    byScore = sa > sb ? a : b;
  }

  const winner = result.winner ?? byScore;
  if (winner === null || winner === undefined) throw new BracketError('Indique l’équipe qui a gagné.');
  if (winner !== a && winner !== b) {
    throw new BracketError('Le vainqueur doit être l’une des deux équipes de la rencontre.');
  }
  if (byScore !== null && byScore !== winner) {
    throw new BracketError('Le score contredit le vainqueur indiqué.');
  }

  const before = o.state === 'done' ? o.winner : null;
  m.winner = winner;
  m.sa = sa;
  m.sb = sb;
  if (before !== winner) clearDependents(event.matches, index);
  return settle(event);
}

// ---------------------------------------------------------------------------
// Lecture pour l'interface
// ---------------------------------------------------------------------------

/** Index de l'équipe d'un joueur, ou null s'il ne joue pas (remplaçant, spectateur). */
export function teamIndexOf(event: Pick<MatchEvent, 'teams'>, playerId: string): number | null {
  const index = event.teams.findIndex((t) => t.members.some((m) => m.id === playerId));
  return index >= 0 ? index : null;
}

const SIDE_RANK: Record<BracketSide, number> = { winners: 0, losers: 1, final: 2 };

/** Plus la rencontre est tardive dans le tournoi, plus la valeur est grande. */
function lateness(m: BracketMatch): number {
  return SIDE_RANK[m.side] * 1000 + m.round;
}

/** Rencontre où une équipe a été éliminée (deuxième défaite, ou défaite en finale), ou null. */
function eliminationOf(matches: BracketMatch[], out: Outcome[], team: number, champion: number | null): number | null {
  let losses = 0;
  let last: number | null = null;
  for (let i = 0; i < matches.length; i++) {
    if (out[i].state !== 'done' || out[i].loser !== team) continue;
    losses++;
    last = i;
    if (losses === 2) return i;
  }
  // Tournoi fini sans deuxième défaite : battue en finale sans revanche.
  return champion !== null && team !== champion ? last : null;
}

/**
 * Place d'une équipe éliminée : 1 + le nombre d'équipes qui finiront devant elle
 * (encore en lice, ou éliminées plus tard). Les équipes sorties au même tour du
 * même tableau partagent la place.
 */
function placeOf(event: Pick<MatchEvent, 'matches' | 'teams'>, out: Outcome[], team: number, champion: number | null): number {
  const mine = eliminationOf(event.matches, out, team, champion);
  if (mine === null) return 1;
  const myLateness = lateness(event.matches[mine]);
  let ahead = 0;
  for (let t = 0; t < event.teams.length; t++) {
    if (t === team) continue;
    const other = eliminationOf(event.matches, out, t, champion);
    if (other === null || lateness(event.matches[other]) > myLateness) ahead++;
  }
  return ahead + 1;
}

/** Où va chercher une équipe encore inconnue : le vainqueur ou le perdant d'une rencontre. */
export type Source = { match: number; take: 'winner' | 'loser' };

export type TeamStatus =
  | { kind: 'champion' }
  | { kind: 'eliminated'; place: number }
  /** Rencontre à jouer maintenant. `court` est null si tous les terrains sont occupés. */
  | { kind: 'play'; match: number; opponent: number; court: number | null }
  /** Qualifiée pour `match`, en attente de son adversaire. */
  | { kind: 'wait'; match: number; source: Source | null };

/** Situation d'une équipe, du point de vue de ses joueurs. */
export function teamStatus(event: Pick<MatchEvent, 'matches' | 'teams'>, team: number, out = outcomes(event.matches)): TeamStatus & { losses: number } {
  const losses = lossesOf(out, team);
  const champion = championOf(event.matches, out);
  if (champion === team) return { kind: 'champion', losses };
  if (eliminationOf(event.matches, out, team, champion) !== null) {
    return { kind: 'eliminated', place: placeOf(event, out, team, champion), losses };
  }

  const playing = out.findIndex((o) => o.state === 'ready' && (o.a === team || o.b === team));
  if (playing >= 0) {
    const o = out[playing];
    return {
      kind: 'play',
      match: playing,
      opponent: (o.a === team ? o.b : o.a) as number,
      court: event.matches[playing].court,
      losses,
    };
  }

  const waiting = out.findIndex((o) => o.state === 'pending' && (o.a === team || o.b === team));
  if (waiting >= 0) {
    const m = event.matches[waiting];
    const other = out[waiting].a === team ? m.b : m.a;
    const source = other !== null && 'from' in other ? { match: other.from, take: other.take } : null;
    return { kind: 'wait', match: waiting, source, losses };
  }
  // Inatteignable dans un tableau cohérent ; on reste prudent.
  return { kind: 'wait', match: -1, source: null, losses };
}

/** Libellé d'une rencontre : « Gagnants · tour 1 », « Finale des perdants », « Grande finale »… */
export function matchLabel(matches: BracketMatch[], index: number): string {
  const m = matches[index];
  if (m.side === 'final') return m.reset ? 'Revanche de la grande finale' : 'Grande finale';
  const last = Math.max(...matches.filter((x) => x.side === m.side).map((x) => x.round));
  if (m.side === 'winners') return m.round === last ? 'Finale des gagnants' : `Gagnants · tour ${m.round + 1}`;
  return m.round === last ? 'Finale des perdants' : `Perdants · tour ${m.round + 1}`;
}

/** Rencontres « réelles » (ni exempt ni revanche inutile), jouées et au total — pour un résumé. */
export function progress(matches: BracketMatch[], out = outcomes(matches)): { played: number; total: number } {
  let played = 0;
  let total = 0;
  out.forEach((o, i) => {
    if (o.state === 'walkover' || o.state === 'skipped') return;
    // Une revanche encore hypothétique ne compte pas dans le total.
    if (matches[i].reset && o.state === 'pending') return;
    total++;
    if (o.state === 'done') played++;
  });
  return { played, total };
}
