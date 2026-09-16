'use client';
/**
 * Racine de l'interface : identité (cookie de session + localStorage), onglets,
 * synchronisation avec le serveur et navigation liste ↔ fiche de match.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { VersionedState } from '@/lib/types';
import { LEVEL_LABELS } from '@/lib/constants';
import { useServerState } from '@/lib/client/useServerState';
import { registerServiceWorker } from '@/lib/client/push';
import { ToastProvider, useToast } from './Toasts';
import Identity from './Identity';
import Matches from './Matches';
import EventDetail from './EventDetail';
import Players from './Players';
import Archive from './Archive';
import { useTournamentAlerts } from './TournamentAlerts';

type Tab = 'matchs' | 'joueurs' | 'archives';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'matchs', label: 'Matchs' },
  { id: 'joueurs', label: 'Joueurs' },
  { id: 'archives', label: 'Archives' },
];

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const toast = useToast();
  const { state, me, setMe, apply, offline, fatal } = useServerState();
  const [tab, setTab] = useState<Tab>('matchs');
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const seenCycle = useRef<string | null>(null);
  useTournamentAlerts(state, me);

  // Démarrage : lien profond (?event=…) et service worker.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('event');
    if (wanted) {
      setOpenEventId(wanted);
      window.history.replaceState(null, '', '/');
    }
    void registerServiceWorker();
  }, []);

  // Changement de cycle : les matchs ont été archivés.
  useEffect(() => {
    if (!state) return;
    if (seenCycle.current && seenCycle.current !== state.cycle.id) {
      toast('Nouveau cycle : les matchs précédents ont été archivés.', 'info');
      setOpenEventId(null);
    }
    seenCycle.current = state.cycle.id;
  }, [state, toast]);

  // La fiche ouverte n'existe plus (supprimée par quelqu'un d'autre).
  useEffect(() => {
    if (!state || !openEventId) return;
    if (!state.events[openEventId]) {
      setOpenEventId(null);
      toast('Ce match n’existe plus.', 'info');
    }
  }, [state, openEventId, toast]);

  const onSaved = useCallback(
    (id: string, next: VersionedState) => {
      setMe(id);
      apply(next);
      setEditingIdentity(false);
    },
    [apply, setMe],
  );

  const player = me && state ? state.players[me] : undefined;
  const identified = Boolean(player);

  let main: ReactNode;
  if (fatal) {
    main = (
      <div className="card">
        <h1>Stockage non configuré</h1>
        <p>{fatal}</p>
      </div>
    );
  } else if (!state) {
    main = <p className="center muted">{offline ? 'Serveur injoignable…' : 'Connexion…'}</p>;
  } else if (!identified || editingIdentity) {
    main = (
      <Identity
        playerId={me}
        initial={player ? { name: player.name, level: player.level } : null}
        state={state}
        onSaved={onSaved}
        onCancel={identified ? () => setEditingIdentity(false) : undefined}
      />
    );
  } else if (tab === 'matchs') {
    const event = openEventId ? state.events[openEventId] : undefined;
    main =
      openEventId && event ? (
        <EventDetail
          id={openEventId}
          event={event}
          state={state}
          me={me as string}
          apply={apply}
          onBack={() => setOpenEventId(null)}
        />
      ) : (
        <Matches state={state} me={me as string} apply={apply} onOpen={setOpenEventId} />
      );
  } else if (tab === 'joueurs') {
    main = <Players state={state} me={me as string} onEdit={() => setEditingIdentity(true)} />;
  } else {
    main = <Archive />;
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            V
          </span>
          Vestiaire
        </div>
        {player && (
          <div className="who">
            <span className="who-name">{player.name}</span>
            <span className="who-level">{LEVEL_LABELS[player.level]}</span>
            <button className="link" type="button" onClick={() => setEditingIdentity(true)}>
              modifier
            </button>
          </div>
        )}
      </header>

      {offline && state && (
        <div className="offline">Hors ligne : les informations affichées peuvent être anciennes.</div>
      )}

      {identified && !editingIdentity && (
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setOpenEventId(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}

      <main>{main}</main>
    </div>
  );
}
