/**
 * Utilitaires communs aux routes d'API : validation des entrées, erreurs HTTP
 * lisibles en français, réponses JSON non mises en cache.
 */
import { NextResponse } from 'next/server';
import type { MatchEvent, State } from './types.ts';
import {
  MAX_LEVEL,
  MAX_NAME_LENGTH,
  MAX_SCORE,
  MAX_TEAM_SIZE,
  MAX_TITLE_LENGTH,
  MIN_TEAM_SIZE,
} from './constants.ts';
import { ConflictError } from './store.ts';
import { BalanceError } from './balance.ts';
import { BracketError } from './bracket.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function bad(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

/** Réponse JSON jamais mise en cache. */
export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store');
  return NextResponse.json(data, { ...init, headers });
}

/**
 * Enveloppe un gestionnaire de route : convertit les erreurs en réponses JSON.
 * Les erreurs métier (équilibrage, tableau) sont des erreurs de saisie → 400.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
    if (err instanceof BalanceError || err instanceof BracketError) {
      return json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ConflictError) return json({ error: err.message }, { status: 409 });
    console.error('[vestiaire] erreur interne', err);
    return json({ error: 'Erreur interne du serveur.' }, { status: 500 });
  }
}

/** Lit un corps JSON ; renvoie un objet vide si absent, 400 s'il est illisible. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return bad('Corps de requête JSON invalide.');
  }
}

// --- Nettoyage des champs -----------------------------------------------------

/** Convertit un nombre ou une chaîne numérique en entier, sinon null. */
export function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export function cleanId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    return bad(`Identifiant ${what} invalide.`);
  }
  return value;
}

export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return bad('Le prénom est obligatoire.');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return bad('Le prénom est obligatoire.');
  if (name.length > MAX_NAME_LENGTH) {
    return bad(`Le prénom ne doit pas dépasser ${MAX_NAME_LENGTH} caractères.`);
  }
  return name;
}

export function cleanLevel(value: unknown): number {
  const level = toInt(value);
  if (level === null || level < 0 || level > MAX_LEVEL) {
    return bad(`Le niveau doit être un entier entre 0 et ${MAX_LEVEL}.`);
  }
  return level;
}

export function cleanTeamSize(value: unknown): number {
  const size = toInt(value);
  if (size === null || size < MIN_TEAM_SIZE || size > MAX_TEAM_SIZE) {
    return bad(`Le nombre de joueurs par équipe doit être un entier entre ${MIN_TEAM_SIZE} et ${MAX_TEAM_SIZE}.`);
  }
  return size;
}

/** Titre facultatif : null si vide. */
export function cleanTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return bad('Le titre doit être un texte.');
  const title = value.trim().replace(/\s+/g, ' ');
  if (title.length > MAX_TITLE_LENGTH) {
    return bad(`Le titre ne doit pas dépasser ${MAX_TITLE_LENGTH} caractères.`);
  }
  return title || null;
}

export function cleanScore(value: unknown, what: string): number {
  const score = toInt(value);
  if (score === null || score < 0 || score > MAX_SCORE) {
    return bad(`Le score ${what} doit être un entier entre 0 et ${MAX_SCORE}.`);
  }
  return score;
}

export function cleanIndex(value: unknown, what: string): number {
  const index = toInt(value);
  if (index === null || index < 0) return bad(`Index ${what} invalide.`);
  return index;
}

/** Retrouve un match dans l'état, ou 404. */
export function getEvent(state: State, id: string): MatchEvent {
  const event = state.events[id];
  if (!event) return notFound('Ce match n’existe plus (supprimé ou archivé).');
  return event;
}

/** Vérifie l'en-tête Authorization envoyé par les crons Vercel. */
export function checkCronSecret(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) return; // pas de secret configuré : route ouverte (rotation idempotente)
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    throw new HttpError(401, 'Non autorisé.');
  }
}
