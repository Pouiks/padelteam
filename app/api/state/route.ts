/**
 * GET /api/state          → état complet { version, cycle, players, events }
 * GET /api/state?v=<n>    → { unchanged: true, version } si rien n'a changé
 *                           depuis la version n (interrogation légère toutes
 *                           les quelques secondes côté client).
 */
import { getStore } from '@/lib/db';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const state = await getStore().getState();
    const known = new URL(req.url).searchParams.get('v');
    if (known !== null && Number(known) === state.version) {
      return json({ unchanged: true, version: state.version });
    }
    return json(state);
  });
}
