/**
 * POST /api/events/:id/reopen
 * Rouvre les inscriptions : équipes, tableau et scores sont effacés.
 */
import { getStore } from '@/lib/db';
import { bad, cleanId, getEvent, handle, json } from '@/lib/api';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id: rawId } = await ctx.params;
    const id = cleanId(rawId, 'de match');
    const { state } = await getStore().mutate((s) => {
      const event = getEvent(s, id);
      if (event.status === 'open') return bad('Les inscriptions sont déjà ouvertes.');
      event.status = 'open';
      event.teams = [];
      event.subs = [];
      event.rounds = [];
      event.winner = null;
    });
    return json({ ok: true, state });
  });
}
