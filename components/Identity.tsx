'use client';
/**
 * Premier écran : prénom + niveau. Aussi utilisé pour modifier son profil —
 * le niveau se change à tout moment, il est repris dans les matchs encore
 * ouverts (les matchs lancés gardent les équipes telles qu'elles ont été tirées).
 *
 * Sur un appareil que le serveur ne reconnaît pas — cookie expiré, stockage du
 * navigateur vidé, lien ouvert depuis une autre application — on propose de
 * reprendre sa place dans la liste plutôt que de créer un doublon.
 */
import { useState, type FormEvent } from 'react';
import type { VersionedState } from '@/lib/types';
import { LEVEL_LABELS, MAX_NAME_LENGTH } from '@/lib/constants';
import { api } from '@/lib/client/api';
import { newPlayerId } from '@/lib/client/format';
import { useToast } from './Toasts';

interface Props {
  /** Identifiant déjà connu pour cet appareil, ou null pour un nouveau joueur. */
  playerId: string | null;
  initial: { name: string; level: number } | null;
  state: VersionedState;
  onSaved: (id: string, state: VersionedState) => void;
  onCancel?: () => void;
}

export default function Identity({ playerId, initial, state, onSaved, onCancel }: Props) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [level, setLevel] = useState<number | null>(initial?.level ?? null);
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const known = Object.entries(state.players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast('Indique ton prénom.');
    if (level === null) return toast('Choisis ton niveau.');
    setBusy(true);
    try {
      const id = playerId ?? newPlayerId();
      const res = await api<{ state: VersionedState }>(
        'PUT',
        `/api/players/${encodeURIComponent(id)}`,
        { name: trimmed, level },
      );
      onSaved(id, res.state);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Rattache cet appareil à un joueur déjà présent, avec ses inscriptions. */
  async function claim(id: string) {
    setBusy(true);
    try {
      const res = await api<{ state: VersionedState }>('POST', '/api/session', { playerId: id });
      onSaved(id, res.state);
      toast('Te revoilà ! Tes inscriptions sont conservées.', 'ok');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (claiming) {
    return (
      <section className="card identity">
        <h1>Qui es-tu ?</h1>
        <p className="muted">
          Choisis ton prénom : cet appareil reprendra ton profil et tes inscriptions en cours.
        </p>
        <ul className="players claim">
          {known.map((p) => (
            <li key={p.id}>
              <button type="button" className="claim-row" disabled={busy} onClick={() => void claim(p.id)}>
                <span className="pname">{p.name}</span>
                <span className="plevel">
                  <b>{p.level}</b> {LEVEL_LABELS[p.level] ?? ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button className="btn ghost block" type="button" onClick={() => setClaiming(false)}>
          Aucun de ceux-là, je suis nouveau
        </button>
      </section>
    );
  }

  return (
    <form className="card identity" onSubmit={submit}>
      <h1>{initial ? 'Mon profil' : 'Bienvenue au vestiaire'}</h1>
      <p className="muted">
        {initial
          ? 'Change ton prénom ou ton niveau quand tu veux : les matchs à venir en tiendront compte.'
          : 'Ton prénom et ton niveau servent à équilibrer les équipes. Pas de compte, pas de mot de passe.'}
      </p>
      <label className="field">
        <span>Prénom</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="given-name"
          autoFocus={!initial}
          required
        />
      </label>
      <div className="field">
        <span>Niveau</span>
        <div className="levels">
          {LEVEL_LABELS.map((label, i) => (
            <button
              type="button"
              key={label}
              className="level"
              aria-pressed={level === i}
              onClick={() => setLevel(i)}
            >
              <b>{i}</b>
              <small>{label}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>
          {initial ? 'Enregistrer' : 'C’est parti'}
        </button>
        {onCancel && (
          <button className="btn ghost" type="button" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
      {!initial && known.length > 0 && (
        <p className="hint">
          Déjà inscrit·e sur un autre appareil ou après un nettoyage du navigateur ?{' '}
          <button className="link" type="button" onClick={() => setClaiming(true)}>
            Reprendre ma place
          </button>
        </p>
      )}
    </form>
  );
}
