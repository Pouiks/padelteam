/**
 * Textes du tournoi vus par un joueur : ce que son équipe doit faire maintenant,
 * contre qui, sur quel terrain — ou qui elle attend. Partagé par la fiche du
 * match et la liste des matchs.
 */
import type { MatchEvent } from '@/lib/types';
import { matchLabel, outcomes, teamStatus, type Outcome, type Source, type TeamStatus } from '@/lib/bracket';

type Status = TeamStatus & { losses: number };

/** « le vainqueur de Rouges – Jaunes », ou « le vainqueur du match « Finale des perdants » » si pas encore connus. */
export function sourceText(event: MatchEvent, out: Outcome[], source: Source | null): string {
  if (!source) return 'à déterminer';
  const who = source.take === 'winner' ? 'le vainqueur' : 'le perdant';
  const o = out[source.match];
  if (o && typeof o.a === 'number' && typeof o.b === 'number') {
    return `${who} de ${event.teams[o.a].name} – ${event.teams[o.b].name}`;
  }
  return `${who} du match « ${matchLabel(event.matches, source.match)} »`;
}

/** Nom d'une place encore inconnue dans une rencontre, pour l'affichage du tableau. */
export function slotText(event: MatchEvent, out: Outcome[], index: number, side: 'a' | 'b'): string {
  const resolved = out[index][side];
  if (typeof resolved === 'number') return event.teams[resolved].name;
  const slot = event.matches[index][side];
  if (slot === null || 'team' in slot) return '—';
  const source = out[slot.from];
  // Dans une case du tableau, la version courte suffit quand la rencontre source
  // n'a pas encore ses équipes : « Vainqueur · Finale des perdants ».
  if (typeof source?.a !== 'number' || typeof source?.b !== 'number') {
    return `${slot.take === 'winner' ? 'Vainqueur' : 'Perdant'} · ${matchLabel(event.matches, slot.from)}`;
  }
  const text = sourceText(event, out, { match: slot.from, take: slot.take });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Change dès que la situation de l'équipe change : sert à prévenir le joueur. */
export function statusSignature(status: Status): string {
  switch (status.kind) {
    case 'play':
      return `play:${status.match}:${status.court}`;
    case 'wait':
      return `wait:${status.match}`;
    case 'eliminated':
      return `out:${status.place}`;
    case 'champion':
      return 'champion';
  }
}

/** « 1re », « 2e », « 3e ». */
export function placeText(place: number): string {
  return place === 1 ? '1re' : `${place}e`;
}

/**
 * Ce que l'équipe doit savoir maintenant, en une phrase. `previousLosses` permet
 * d'annoncer la bascule dans le tableau des perdants au moment où elle arrive.
 */
export function statusMessage(event: MatchEvent, status: Status, previousLosses?: number): string {
  const out = outcomes(event.matches);
  const dropped =
    previousLosses === 0 && status.losses === 1 && status.kind !== 'eliminated'
      ? 'Défaite, mais ce n’est pas fini : direction le tableau des perdants. '
      : '';

  switch (status.kind) {
    case 'champion':
      return '🏆 Vous remportez le tournoi !';
    case 'eliminated':
      return `Éliminés — ${placeText(status.place)} place. Merci pour les matchs !`;
    case 'play': {
      const label = matchLabel(event.matches, status.match).toLowerCase();
      const opponent = event.teams[status.opponent].name;
      return status.court !== null
        ? `${dropped}À vous ! Terrain ${status.court} contre les ${opponent} (${label}).`
        : `${dropped}Prochain match contre les ${opponent} (${label}), dès qu’un terrain se libère.`;
    }
    case 'wait': {
      if (status.match < 0) return `${dropped}En attente de la suite du tableau.`;
      const label = matchLabel(event.matches, status.match).toLowerCase();
      return `${dropped}Prochain match (${label}) contre ${sourceText(event, out, status.source)}.`;
    }
  }
}

/** Situation de l'équipe d'un joueur, ou null s'il ne joue pas. */
export function myStatus(event: MatchEvent, team: number | null): Status | null {
  if (team === null || event.status === 'open' || event.matches.length === 0) return null;
  return teamStatus(event, team);
}
