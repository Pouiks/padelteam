/**
 * POST /api/events  { title?, teamSize, courts?, join, playerId }
 * Crée un match dans le cycle courant, puis prévient les abonnés push.
 */
import crypto from 'node:crypto';
import { getStore } from '@/lib/db';
import { defaultTitle } from '@/lib/cycle';
import { broadcast, newEventPayload } from '@/lib/push';
import { bad, cleanCourts, cleanId, cleanTeamSize, cleanTitle, handle, json, readJson } from '@/lib/api';
import type { MatchEvent } from '@/lib/types';

function newEventId(): string {
  return `e-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(req);
    const playerId = cleanId(body.playerId, 'de joueur');
    const teamSize = cleanTeamSize(body.teamSize);
    const courts = cleanCourts(body.courts);
    const title = cleanTitle(body.title);
    const join = body.join === true || body.join === 'true';

    const store = getStore();
    const { result, state } = await store.mutate((s) => {
      const player = s.players[playerId];
      if (!player) return bad('Joueur inconnu : renseigne ton prénom et ton niveau d’abord.');
      const id = newEventId();
      const now = new Date();
      const event: MatchEvent = {
        title: title ?? defaultTitle(now, process.env.APP_TIMEZONE || 'Europe/Paris'),
        teamSize,
        courts,
        createdBy: playerId,
        createdAt: now.toISOString(),
        status: 'open',
        participants: join ? [{ id: playerId, name: player.name, level: player.level }] : [],
        teams: [],
        subs: [],
        matches: [],
        winner: null,
      };
      s.events[id] = event;
      return { id, event, creatorName: player.name };
    });

    // Notification « nouveau match » : jamais bloquante pour le créateur.
    await broadcast(store, newEventPayload(result.id, result.event, result.creatorName), playerId);

    return json({ id: result.id, event: result.event, state }, { status: 201 });
  });
}
