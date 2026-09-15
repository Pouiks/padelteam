/** Petits utilitaires d'affichage côté client. */

/** « 3 inscrits », « 1 joueur ». */
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateTimeFmt.format(d);
}

/** « 31 h 12 », « 45 min », « quelques instants ». */
export function countdownText(endsAt: number, now: number): string {
  const remaining = endsAt - now;
  if (remaining <= 0) return 'quelques instants';
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** Identifiant de joueur généré sur l'appareil (jamais deviné par le serveur). */
export function newPlayerId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `p-${Date.now().toString(36)}-${random}`;
}
