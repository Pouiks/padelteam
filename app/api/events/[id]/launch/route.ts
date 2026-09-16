/**
 * POST /api/events/:id/launch
 * Forme les équipes équilibrées et le tableau à double élimination ; le match
 * passe en `running` et les premières rencontres reçoivent leur terrain.
 */
import { getStore } from '@/lib/db';
import { balance } from '@/lib/balance';
import { createBracket, settle } from '@/lib/bracket';
import { bad, cleanId, getEvent, handle, json } from '@/lib/api';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id: rawId } = await ctx.params;
    const id = cleanId(rawId, 'de match');
    const { state } = await getStore().mutate((s) => {
      const event = getEvent(s, id);
      if (event.status !== 'open') return bad('Ce match est déjà lancé.');
      if (event.participants.length < 2 * event.teamSize) {
        return bad(
          `Il faut au moins ${2 * event.teamSize} inscrits pour former deux équipes de ${event.teamSize}.`,
        );
      }
      const { teams, subs } = balance(event.participants, event.teamSize);
      event.teams = teams;
      event.subs = subs;
      event.matches = createBracket(teams.length);
      event.status = 'running';
      settle(event);
    });
    return json({ ok: true, state });
  });
}
