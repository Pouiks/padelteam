'use client';
/**
 * Synchronisation avec le serveur. Sur Vercel (serverless), pas de connexion
 * persistante : le client interroge GET /api/state?v=<version> toutes les
 * quelques secondes quand l'onglet est visible. Si rien n'a changé, la réponse
 * est minuscule. Les réponses des mutations contiennent le nouvel état, appliqué
 * immédiatement via `apply`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VersionedState } from '@/lib/types';
import { api } from './api';

const POLL_MS = 5000;

type StateResponse = VersionedState | { unchanged: true; version: number };

export function useServerState() {
  const [state, setState] = useState<VersionedState | null>(null);
  const [offline, setOffline] = useState(false);
  const versionRef = useRef(-1);

  const apply = useCallback((next: VersionedState) => {
    // Une réponse arrivée en retard ne doit pas écraser un état plus récent.
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api<StateResponse>('GET', `/api/state?v=${versionRef.current}`);
      if (!('unchanged' in res)) apply(res);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [apply]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const start = () => {
      if (timer === null) timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick();
        start();
      } else {
        stop();
      }
    };
    tick();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
    };
  }, [refresh]);

  return { state, apply, refresh, offline };
}
