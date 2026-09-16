/**
 * PUT /api/players/:id  { name, level }
 * Crée ou met à jour un joueur (prénom et niveau, modifiables à tout moment).
 * L'identifiant est généré par l'appareil du joueur : pas de compte, pas de mot
 * de passe. La réponse pose le cookie de session pour que cet appareil se
 * souvienne de qui il est même si le localStorage est effacé.
 * Le nouveau nom/niveau est répercuté sur les inscriptions aux matchs encore
 * ouverts ; les matchs lancés gardent leur photographie.
 */
import { getStore } from '@/lib/db';
import { cleanId, cleanLevel, cleanName, handle, json, readJson } from '@/lib/api';
import { setSessionCookie } from '@/lib/session';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id: rawId } = await ctx.params;
    const id = cleanId(rawId, 'de joueur');
    const body = await readJson(req);
    const name = cleanName(body.name);
    const level = cleanLevel(body.level);

    const { result, state } = await getStore().mutate((s) => {
      const player = { name, level, updatedAt: new Date().toISOString() };
      s.players[id] = player;
      for (const event of Object.values(s.events)) {
        if (event.status !== 'open') continue;
        for (const p of event.participants) {
          if (p.id === id) {
            p.name = name;
            p.level = level;
          }
        }
      }
      return { id, ...player };
    });

    return setSessionCookie(json({ player: result, me: id, state }), id);
  });
}
