/**
 * Session d'appareil.
 *
 * L'identité tenait uniquement dans `localStorage`, que les navigateurs
 * effacent volontiers (Safari/iOS purge le stockage écrit par script après
 * quelques jours, les navigateurs intégrés à WhatsApp ou Instagram ont leur
 * propre bac à sable, la navigation privée repart de zéro). Quand il disparaît,
 * l'application ne sait plus qui est devant l'écran : le joueur et ses
 * inscriptions sont pourtant toujours sur le serveur.
 *
 * On ajoute donc un cookie posé par le serveur, bien plus résistant, et
 * rafraîchi à chaque appel. `localStorage` reste en second filet : il suffit
 * que l'un des deux survive pour retrouver son identité. Aucun secret ici :
 * l'identifiant n'est pas un mot de passe, c'est un groupe de potes.
 */
import type { NextResponse } from 'next/server';
import type { State } from './types.ts';

export const SESSION_COOKIE = 'vestiaire_pid';

/** 400 jours : le maximum accepté par les navigateurs (Chrome le plafonne là). */
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Identifiant de joueur mémorisé sur cet appareil, ou null. */
export function readSessionId(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return ID_PATTERN.test(value) ? value : null;
  }
  return null;
}

/** Pose (ou prolonge) le cookie de session sur une réponse. */
export function setSessionCookie(res: NextResponse, playerId: string): NextResponse {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: playerId,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    sameSite: 'lax',
    // Le client n'a pas besoin de le lire : /api/state lui renvoie déjà `me`.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

/**
 * Détermine qui consulte l'application.
 * @param cookieId identifiant issu du cookie de session
 * @param deviceId identifiant issu du localStorage du navigateur
 * @returns l'identifiant retenu (celui d'un joueur qui existe vraiment), ou null
 */
export function resolvePlayerId(
  state: Pick<State, 'players'>,
  cookieId: string | null,
  deviceId: string | null,
): string | null {
  if (cookieId && state.players[cookieId]) return cookieId;
  if (deviceId && state.players[deviceId]) return deviceId;
  return null;
}
