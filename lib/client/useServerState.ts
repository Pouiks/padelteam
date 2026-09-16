'use client';
/**
 * Synchronisation avec le serveur. Sur Vercel (serverless), pas de connexion
 * persistante : le client interroge GET /api/state?v=<version> toutes les
 * quelques secondes quand l'onglet est visible. Si rien n'a changé, la réponse
 * est minuscule. Les réponses des mutations contiennent le nouvel état, appliqué
 * immédiatement via `apply`.
 *
 * Le hook porte aussi l'identité : `me` est décidé par le serveur, à partir du
 * cookie de session ou, à défaut, de l'identifiant conservé dans le
 * localStorage et envoyé en paramètre `device`. Les deux sont maintenus en
 * miroir, pour que la perte de l'un ne déconnecte pas le joueur.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VersionedState } from '@/lib/types';
import { PLAYER_ID_KEY } from '@/lib/constants';
import { api } from './api';

const POLL_MS = 5000;

type StateResponse =
  | (VersionedState & { me: string | null })
  | { unchanged: true; version: number; me: string | null };

/** Lit l'identifiant mémorisé par le navigateur (absent en navigation privée). */
function readDeviceId(): string | null {
  try {
    return localStorage.getItem(PLAYER_ID_KEY);
  } catch {
    return null;
  }
}

/** Mémorise l'identifiant côté navigateur, en doublure du cookie de session. */
export function writeDeviceId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(PLAYER_ID_KEY);
    else localStorage.setItem(PLAYER_ID_KEY, id);
  } catch {
    // Stockage refusé : le cookie de session prend seul le relais.
  }
}

export function useServerState() {
  const [state, setState] = useState<VersionedState | null>(null);
  const [me, setMeState] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const versionRef = useRef(-1);
  const deviceRef = useRef<string | null>(null);

  const apply = useCallback((next: VersionedState) => {
    // Une réponse arrivée en retard ne doit pas écraser un état plus récent.
    if (next.version < versionRef.current) return;
    versionRef.current = next.version;
    setState(next);
  }, []);

  /** Enregistre l'identité retenue, des deux côtés (cookie déjà posé par le serveur). */
  const setMe = useCallback((id: string | null) => {
    deviceRef.current = id;
    writeDeviceId(id);
    setMeState(id);
  }, []);

  const refresh = useCallback(async () => {
    const device = deviceRef.current;
    const query = `v=${versionRef.current}${device ? `&device=${encodeURIComponent(device)}` : ''}`;
    try {
      const res = await api<StateResponse>('GET', `/api/state?${query}`);
      if (!('unchanged' in res)) apply(res);
      // Le serveur fait autorité : il a pu nous reconnaître via le cookie alors
      // que le localStorage était vide (ou l'inverse).
      setMeState(res.me);
      if (res.me && res.me !== deviceRef.current) {
        deviceRef.current = res.me;
        writeDeviceId(res.me);
      }
      setOffline(false);
      setFatal(null);
    } catch (err) {
      // 503 : stockage non configuré côté serveur. Inutile de faire croire à
      // une coupure réseau, le message explique quoi faire.
      const { status, message } = err as { status?: number; message: string };
      if (status === 503) setFatal(message);
      else setOffline(true);
    }
  }, [apply]);

  useEffect(() => {
    deviceRef.current = readDeviceId();
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
    // `pageshow` couvre le retour depuis le cache arrière des navigateurs
    // mobiles, où `visibilitychange` ne se déclenche pas toujours.
    tick();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', tick);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', tick);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
    };
  }, [refresh]);

  return { state, me, setMe, apply, refresh, offline, fatal };
}
