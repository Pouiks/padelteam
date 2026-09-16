'use client';
/**
 * Prévient chaque joueur dès que la situation de son équipe change dans un
 * tournoi : adversaire connu, terrain libéré, bascule chez les perdants,
 * élimination, victoire. Fonctionne quel que soit l'écran affiché, et surtout
 * quand c'est une autre équipe qui a déclaré le résultat : l'état arrive par la
 * synchronisation en fond, le message suit.
 */
import { useEffect, useRef } from 'react';
import type { VersionedState } from '@/lib/types';
import { teamIndexOf } from '@/lib/bracket';
import { myStatus, statusMessage, statusSignature } from '@/lib/client/tournament';
import { useToast } from './Toasts';

export function useTournamentAlerts(state: VersionedState | null, me: string | null): void {
  const toast = useToast();
  /** Dernière situation connue de mon équipe, par match. */
  const seen = useRef(new Map<string, { signature: string; losses: number }>());

  useEffect(() => {
    if (!state || !me) return;
    const mine = Object.entries(state.events)
      .map(([id, event]) => ({ id, event, status: myStatus(event, teamIndexOf(event, me)) }))
      .filter((x) => x.status !== null);

    for (const { id, event, status } of mine) {
      if (!status) continue;
      const signature = statusSignature(status);
      const before = seen.current.get(id);
      seen.current.set(id, { signature, losses: status.losses });
      // Premier affichage : on ne rejoue pas l'historique, on note seulement.
      if (!before || before.signature === signature) continue;
      const message = statusMessage(event, status, before.losses);
      toast(mine.length > 1 ? `${event.title} — ${message}` : message, 'info');
    }
  }, [state, me, toast]);
}
