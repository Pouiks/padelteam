'use client';
/** Bouton d'activation des notifications « nouveau match ». */
import { useEffect, useState } from 'react';
import {
  getCurrentSubscription,
  getPushConfig,
  isIOS,
  isStandalone,
  pushSupported,
  subscribeToPush,
  syncSubscription,
  unsubscribeFromPush,
} from '@/lib/client/push';
import { useToast } from './Toasts';

type Status = 'loading' | 'hidden' | 'needs-install' | 'denied' | 'off' | 'on';

export default function PushToggle({ playerId }: { playerId: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<Status>('loading');
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) {
        setStatus(isIOS() && !isStandalone() ? 'needs-install' : 'hidden');
        return;
      }
      const config = await getPushConfig().catch(() => ({ enabled: false, publicKey: null }));
      if (cancelled) return;
      if (!config.enabled || !config.publicKey) {
        setStatus('hidden');
        return;
      }
      setPublicKey(config.publicKey);
      if (Notification.permission === 'denied') {
        setStatus('denied');
        return;
      }
      const subscription = await getCurrentSubscription().catch(() => null);
      if (cancelled) return;
      if (subscription) {
        void syncSubscription(playerId).catch(() => {});
        setStatus('on');
      } else {
        setStatus('off');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  async function toggle() {
    if (!publicKey) return;
    setBusy(true);
    try {
      if (status === 'on') {
        await unsubscribeFromPush();
        setStatus('off');
        toast('Notifications désactivées.', 'info');
      } else {
        await subscribeToPush(publicKey, playerId);
        setStatus('on');
        toast('Tu seras prévenu·e des nouveaux matchs.', 'ok');
      }
    } catch (err) {
      if (Notification.permission === 'denied') setStatus('denied');
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading' || status === 'hidden') return null;

  if (status === 'needs-install') {
    return (
      <p className="hint">
        📲 Pour recevoir les notifications sur iPhone, ajoute d’abord Vestiaire à l’écran d’accueil
        (Partager → « Sur l’écran d’accueil »), puis ouvre-la depuis là.
      </p>
    );
  }

  if (status === 'denied') {
    return <p className="hint">🔕 Notifications bloquées dans les réglages du navigateur pour ce site.</p>;
  }

  return (
    <div className="push-box">
      <span>
        {status === 'on'
          ? '🔔 Tu seras prévenu·e quand un match est créé.'
          : '🔔 Être prévenu·e quand un match est créé ?'}
      </span>
      <button className={`btn small ${status === 'on' ? 'ghost' : 'primary'}`} type="button" disabled={busy} onClick={toggle}>
        {status === 'on' ? 'Désactiver' : 'Activer'}
      </button>
    </div>
  );
}
