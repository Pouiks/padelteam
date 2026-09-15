'use client';
/** Onglet Joueurs : tout le monde, avec son niveau. */
import type { VersionedState } from '@/lib/types';
import { LEVEL_LABELS } from '@/lib/constants';
import { plural } from '@/lib/client/format';

export default function Players({ state, me }: { state: VersionedState; me: string }) {
  const players = Object.entries(state.players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  if (players.length === 0) return <p className="empty">Personne pour l’instant.</p>;

  return (
    <section className="card">
      <h2>{plural(players.length, 'joueur')}</h2>
      <ul className="players">
        {players.map((p) => (
          <li key={p.id} className={p.id === me ? 'me' : undefined}>
            <span className="pname">
              {p.name}
              {p.id === me && <em> (moi)</em>}
            </span>
            <span className="plevel">
              <b>{p.level}</b> {LEVEL_LABELS[p.level] ?? ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
