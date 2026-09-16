/**
 * Types partagés entre le serveur (API, stockage) et le client (React).
 * Aucune valeur à l'exécution ici : ce fichier est importé avec `import type`.
 */

/** Un joueur connu du vestiaire. Il survit aux cycles de 48 h. */
export interface Player {
  name: string;
  /** Niveau entier de 0 (débutant) à 6 (expert). */
  level: number;
  updatedAt: string;
}

/** Copie figée d'un joueur au moment de son inscription à un match. */
export interface Participant {
  id: string;
  name: string;
  level: number;
}

export interface Team {
  name: string;
  members: Participant[];
}

/**
 * Place d'une équipe dans une rencontre : fixée au tirage (`team`), issue d'une
 * autre rencontre (son vainqueur ou son perdant, `from` = index dans
 * `MatchEvent.matches`), ou vide pour de bon (`null`, exempt).
 */
export type Slot = { team: number } | { from: number; take: 'winner' | 'loser' } | null;

/** Tableau auquel appartient une rencontre. */
export type BracketSide = 'winners' | 'losers' | 'final';

/**
 * Une rencontre du tournoi à double élimination. Les équipes ne sont pas
 * stockées : elles se déduisent des places `a` et `b`. Seul le résultat
 * déclaré l'est — `winner` (index d'équipe) et un score facultatif.
 */
export interface BracketMatch {
  side: BracketSide;
  /** Tour dans son tableau (0 = premier). */
  round: number;
  /** Tour de jeu global : les rencontres d'un même tour peuvent se jouer en même temps. */
  stage: number;
  a: Slot;
  b: Slot;
  /** Revanche de grande finale : n'a lieu que si l'équipe du tableau des perdants gagne la première. */
  reset?: boolean;
  winner: number | null;
  sa: number | null;
  sb: number | null;
  /** Terrain (1, 2, …) attribué quand la rencontre est prête à être jouée. */
  court: number | null;
}

export type EventStatus = 'open' | 'running' | 'done';

/** Un match (au sens « événement ») du cycle courant. */
export interface MatchEvent {
  title: string;
  teamSize: number;
  /** Nombre de terrains disponibles : autant de rencontres jouées en même temps. */
  courts: number;
  createdBy: string;
  createdAt: string;
  status: EventStatus;
  participants: Participant[];
  teams: Team[];
  subs: Participant[];
  matches: BracketMatch[];
  /** Index de l'équipe championne dans `teams`, une fois le tournoi terminé. */
  winner: number | null;
}

/**
 * Rencontre de l'ancien tableau à élimination simple. Ne subsiste que dans les
 * archives écrites avant le passage à la double élimination.
 */
export interface LegacyMatch {
  a: number;
  b: number | null;
  winner: number | null;
  sa: number | null;
  sb: number | null;
}

export interface Cycle {
  id: string;
  startedAt: string;
}

export interface State {
  cycle: Cycle;
  players: Record<string, Player>;
  events: Record<string, MatchEvent>;
}

/** État accompagné d'un numéro de version, incrémenté à chaque écriture. */
export interface VersionedState extends State {
  version: number;
}

/** Contenu d'une archive : un cycle terminé et ses matchs. */
export interface ArchivedCycle {
  cycle: Cycle;
  endedAt: string;
  events: Record<string, MatchEvent>;
}

/** Forme renvoyée par GET /api/archive (matchs sous forme de tableau). */
export interface ArchiveSummary {
  id: string;
  startedAt: string;
  endedAt: string;
  events: ArchivedEvent[];
}

/** Match archivé : format actuel (`matches`) ou ancien tableau (`rounds`). */
export type ArchivedEvent = Omit<MatchEvent, 'matches' | 'courts'> & {
  id: string;
  matches?: BracketMatch[];
  courts?: number;
  rounds?: LegacyMatch[][];
};

/** Abonnement Web Push tel que renvoyé par le navigateur, associé à un joueur. */
export interface PushSubscriptionRecord {
  playerId: string;
  subscription: {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  };
  createdAt: string;
}
