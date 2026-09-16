/**
 * POST   /api/session  { playerId }  → rattache cet appareil à un joueur existant
 * DELETE /api/session                → oublie le joueur sur cet appareil
 *
 * Dernier filet quand le cookie *et* le localStorage ont disparu : on se
 * reconnaît dans la liste des joueurs et on reprend sa place, avec ses
 * inscriptions. Pas de mot de passe : c'est un groupe d'amis, et le pire qu'on
 * risque est de cliquer sur le mauvais prénom — ce qui se corrige d'un clic.
 */
import { getStore } from '@/lib/db';
import { cleanId, handle, json, notFound, readJson } from '@/lib/api';
import { SESSION_COOKIE, setSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(req);
    const playerId = cleanId(body.playerId, 'de joueur');

    const state = await getStore().getState();
    const player = state.players[playerId];
    if (!player) return notFound('Ce joueur n’existe plus.');

    return setSessionCookie(json({ me: playerId, player, state }), playerId);
  });
}

export async function DELETE(): Promise<Response> {
  return handle(async () => {
    const res = json({ me: null });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  });
}
