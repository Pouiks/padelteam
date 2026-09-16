/** Constantes partagées serveur/client. */
import type { EventStatus } from './types.ts';

/** Libellés des 7 niveaux, index = niveau. */
export const LEVEL_LABELS = [
  'Débutant',
  'Occasionnel',
  'Régulier',
  'Confirmé',
  'Bon',
  'Très bon',
  'Expert',
] as const;

export const MAX_LEVEL = LEVEL_LABELS.length - 1;
export const MAX_NAME_LENGTH = 30;
export const MAX_TITLE_LENGTH = 60;
export const MIN_TEAM_SIZE = 1;
export const MAX_TEAM_SIZE = 11;
export const MAX_SCORE = 999;
export const MIN_COURTS = 1;
export const MAX_COURTS = 8;
/** En padel à 8 : deux terrains, les quatre équipes jouent en même temps. */
export const DEFAULT_COURTS = 2;

export const STATUS_LABELS: Record<EventStatus, string> = {
  open: 'Inscriptions ouvertes',
  running: 'En cours',
  done: 'Terminé',
};

/** Clé localStorage qui contient l'identifiant du joueur sur cet appareil. */
export const PLAYER_ID_KEY = 'playerId';
