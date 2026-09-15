'use client';
/** Premier écran : prénom + niveau. Aussi utilisé pour modifier son profil. */
import { useState, type FormEvent } from 'react';
import type { VersionedState } from '@/lib/types';
import { LEVEL_LABELS, MAX_NAME_LENGTH } from '@/lib/constants';
import { api } from '@/lib/client/api';
import { newPlayerId } from '@/lib/client/format';
import { useToast } from './Toasts';

interface Props {
  /** Identifiant déjà présent sur l'appareil, ou null pour un nouveau joueur. */
  playerId: string | null;
  initial: { name: string; level: number } | null;
  onSaved: (id: string, state: VersionedState) => void;
  onCancel?: () => void;
}

export default function Identity({ playerId, initial, onSaved, onCancel }: Props) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [level, setLevel] = useState<number | null>(initial?.level ?? null);
  const [busy, setBusy] = useState(false);

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

  return (
    <form className="card identity" onSubmit={submit}>
      <h1>{initial ? 'Mon profil' : 'Bienvenue au vestiaire'}</h1>
      <p className="muted">
        Ton prénom et ton niveau servent à équilibrer les équipes. Pas de compte, pas de mot de passe.
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
    </form>
  );
}
