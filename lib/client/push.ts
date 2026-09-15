/**
 * Côté navigateur : enregistrement du service worker et abonnement Web Push.
 * Sur iPhone/iPad, les notifications ne fonctionnent que si l'application est
 * installée sur l'écran d'accueil (iOS 16.4 et plus).
 */
import { api } from './api';

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
    console.warn('[vestiaire] service worker non enregistré', err);
    return null;
  });
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Vrai si la page tourne comme application installée (plein écran). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export function getPushConfig(): Promise<PushConfig> {
  return api<PushConfig>('GET', '/api/push/config');
}

/** Clé VAPID (base64url) → tableau d'octets attendu par `pushManager.subscribe`. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  const fresh = await registerServiceWorker();
  if (!fresh) throw new Error('Service worker indisponible.');
  return navigator.serviceWorker.ready;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

/** Demande la permission, s'abonne auprès du navigateur puis auprès du serveur. */
export async function subscribeToPush(publicKey: string, playerId: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées par le navigateur.');
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  await api('POST', '/api/push/subscribe', { playerId, subscription: subscription.toJSON() });
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api('DELETE', '/api/push/subscribe', { endpoint }).catch(() => {});
}

/** Renvoie l'abonnement existant au serveur (utile si la base a été réinitialisée). */
export async function syncSubscription(playerId: string): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  await api('POST', '/api/push/subscribe', { playerId, subscription: subscription.toJSON() });
}
