/**
 * Cycle de 48 h : tous les matchs du cycle courant sont archivés puis effacés
 * quand le cycle expire. Les joueurs, eux, sont conservés.
 */
import type { Cycle } from './types.ts';

export const CYCLE_MS = 48 * 60 * 60 * 1000;

export function newCycle(now: number = Date.now()): Cycle {
  return { id: `c-${now}`, startedAt: new Date(now).toISOString() };
}

/** Instant (ms) auquel le cycle se termine. */
export function cycleEndsAt(cycle: Cycle): number {
  return Date.parse(cycle.startedAt) + CYCLE_MS;
}

export function isCycleExpired(cycle: Cycle, now: number = Date.now()): boolean {
  const started = Date.parse(cycle.startedAt);
  // Une date illisible est traitée comme expirée : on repart sur un cycle sain.
  return !Number.isFinite(started) || now - started >= CYCLE_MS;
}

/** Titre par défaut d'un match : « Match du jeudi 17 septembre ». */
export function defaultTitle(date: Date = new Date(), timeZone?: string): string {
  const fmt = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  });
  return `Match du ${fmt.format(date)}`;
}
