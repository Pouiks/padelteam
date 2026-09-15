/**
 * POST /api/events/:id/join  { playerId }
 * Bascule inscription / désinscription, tant que les inscriptions sont ouvertes.
 */
import { getStore } from '@/lib/db';
import { bad, cleanId, getEvent, handle, json, readJson } from '@/lib/api';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id: rawId } = await ctx.params;
    const id = cleanId(rawId, 'de match');
    const body = await readJson(req);
    const playerId = cleanId(body.playerId, 'de joueur');

    const { result, state } = await getStore().mutate((s) => {
      const event = getEvent(s, id);
      if (event.status !== 'open') return bad('Les inscriptions sont closes pour ce match.');
      const player = s.players[playerId];
      if (!player) return bad('Joueur inconnu : renseigne ton prénom et ton niveau d’abord.');
      const index = event.participants.findIndex((p) => p.id === playerId);
      if (index >= 0) {
        event.participants.splice(index, 1);
        return { joined: false };
      }
      event.participants.push({ id: playerId, name: player.name, level: player.level });
      return { joined: true };
    });
    return json({ ...result, state });
  });
}
