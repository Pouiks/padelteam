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
 * Une rencontre du tableau. `a` et `b` sont des index dans `teams`.
 * `b === null` signifie que l'équipe `a` est exemptée (qualifiée d'office).
 * Le résultat est déclaré par `winner` (index de l'équipe gagnante) ; le score
 * `sa`/`sb` est facultatif. Tout reste `null` tant que rien n'est déclaré.
 */
export interface Match {
  a: number;
  b: number | null;
  winner: number | null;
  sa: number | null;
  sb: number | null;
}

export type EventStatus = 'open' | 'running' | 'done';

/** Un match (au sens « événement ») du cycle courant. */
export interface MatchEvent {
  title: string;
  teamSize: number;
  createdBy: string;
  createdAt: string;
  status: EventStatus;
  participants: Participant[];
  teams: Team[];
  subs: Participant[];
  rounds: Match[][];
  /** Index de l'équipe victorieuse dans `teams`, une fois le tableau terminé. */
  winner: number | null;
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
  events: Array<MatchEvent & { id: string }>;
}

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
