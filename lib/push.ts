/**
 * Notifications Web Push (côté serveur) via la bibliothèque `web-push`.
 * Activées seulement si les clés VAPID sont configurées (voir `npm run vapid`).
 * Un nouveau match déclenche une notification vers tous les appareils abonnés,
 * sauf ceux de son créateur.
 */
import webpush from 'web-push';
import type { Store } from './store.ts';
import type { MatchEvent } from './types.ts';

let configured: boolean | null = null;

/** Indique si l'envoi de notifications est possible (clés VAPID présentes). */
export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:vestiaire@example.com';
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    console.warn('[vestiaire] clés VAPID invalides, notifications désactivées', err);
    configured = false;
  }
  return configured;
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY as string) : null;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Envoie une charge utile à tous les abonnés, sauf `excludePlayerId`.
 * Les abonnements expirés (404/410) sont supprimés au passage.
 * Ne lève jamais : un échec d'envoi ne doit pas faire échouer la requête.
 */
export async function broadcast(store: Store, payload: PushPayload, excludePlayerId?: string): Promise<number> {
  if (!pushConfigured()) return 0;
  let subscriptions;
  try {
    subscriptions = await store.getSubscriptions();
  } catch (err) {
    console.warn('[vestiaire] lecture des abonnements impossible', err);
    return 0;
  }
  const targets = subscriptions.filter((s) => s.playerId !== excludePlayerId);
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.allSettled(
    targets.map(async (record) => {
      try {
        await webpush.sendNotification(record.subscription, body, {
          TTL: 6 * 60 * 60,
          urgency: 'high',
          timeout: 5000,
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await store.removeSubscription(record.subscription.endpoint).catch(() => {});
        } else {
          console.warn('[vestiaire] envoi push échoué', status ?? err);
        }
      }
    }),
  );
  return sent;
}

/** Notification « nouveau match ». */
export function newEventPayload(id: string, event: MatchEvent, creatorName: string): PushPayload {
  return {
    title: `Nouveau match : ${event.title}`,
    body: `Équipes de ${event.teamSize} · proposé par ${creatorName}. Inscris-toi !`,
    url: `/?event=${encodeURIComponent(id)}`,
    tag: `event-${id}`,
  };
}
