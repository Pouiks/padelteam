/**
 * POST   /api/push/subscribe  { playerId, subscription } → enregistre un abonnement
 * DELETE /api/push/subscribe  { endpoint }               → le supprime
 */
import { getStore } from '@/lib/db';
import { pushConfigured } from '@/lib/push';
import { bad, cleanId, handle, json, readJson } from '@/lib/api';
import type { PushSubscriptionRecord } from '@/lib/types';

function cleanSubscription(value: unknown): PushSubscriptionRecord['subscription'] {
  const sub = value as Partial<PushSubscriptionRecord['subscription']> | null;
  if (!sub || typeof sub !== 'object') return bad('Abonnement push manquant.');
  if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 2048) {
    return bad('Adresse d’abonnement push invalide.');
  }
  const keys = sub.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return bad('Clés d’abonnement push manquantes.');
  }
  return {
    endpoint: sub.endpoint,
    expirationTime: typeof sub.expirationTime === 'number' ? sub.expirationTime : null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

export async function POST(req: Request): Promise<Response> {
  return handle(async () => {
    if (!pushConfigured()) return bad('Les notifications ne sont pas configurées sur ce serveur.');
    const body = await readJson(req);
    const playerId = cleanId(body.playerId, 'de joueur');
    const subscription = cleanSubscription(body.subscription);
    await getStore().addSubscription({ playerId, subscription, createdAt: new Date().toISOString() });
    return json({ ok: true });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  return handle(async () => {
    const body = await readJson(req);
    if (typeof body.endpoint !== 'string' || !body.endpoint) return bad('Adresse d’abonnement manquante.');
    await getStore().removeSubscription(body.endpoint);
    return json({ ok: true });
  });
}
