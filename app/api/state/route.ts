/**
 * GET /api/state                    → état complet { version, cycle, players, events, me }
 * GET /api/state?v=<n>              → { unchanged: true, version, me } si rien n'a bougé
 * GET /api/state?v=<n>&device=<id>  → `device` est l'identifiant conservé dans le
 *                                     localStorage du navigateur ; il sert de
 *                                     secours quand le cookie de session a disparu.
 *
 * `me` est l'identifiant du joueur reconnu sur cet appareil (ou null). Le cookie
 * de session est reposé à chaque appel, ce qui repousse d'autant son expiration.
 */
import { getStore } from '@/lib/db';
import { handle, json } from '@/lib/api';
import { readSessionId, resolvePlayerId, setSessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const state = await getStore().getState();
    const params = new URL(req.url).searchParams;

    const rawDevice = params.get('device');
    const deviceId = rawDevice && ID_PATTERN.test(rawDevice) ? rawDevice : null;
    const me = resolvePlayerId(state, readSessionId(req), deviceId);

    const known = params.get('v');
    const body =
      known !== null && Number(known) === state.version
        ? { unchanged: true as const, version: state.version, me }
        : { ...state, me };

    const res = json(body);
    // Prolonge le cookie, ou le recrée s'il n'a survécu que dans le localStorage.
    return me ? setSessionCookie(res, me) : res;
  });
}
