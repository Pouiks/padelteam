'use client';
/** Onglet Matchs : compte à rebours du cycle, création, liste des matchs. */
import { useEffect, useState, type FormEvent } from 'react';
import type { MatchEvent, VersionedState } from '@/lib/types';
import {
  DEFAULT_COURTS,
  MAX_COURTS,
  MAX_TEAM_SIZE,
  MAX_TITLE_LENGTH,
  MIN_TEAM_SIZE,
  STATUS_LABELS,
} from '@/lib/constants';
import { cycleEndsAt, defaultTitle } from '@/lib/cycle';
import { progress, teamIndexOf } from '@/lib/bracket';
import { myStatus, placeText } from '@/lib/client/tournament';
import { api } from '@/lib/client/api';
import { countdownText, plural } from '@/lib/client/format';
import { useToast } from './Toasts';
import PushToggle from './PushToggle';

interface Props {
  state: VersionedState;
  me: string;
  apply: (state: VersionedState) => void;
  onOpen: (id: string) => void;
}

const STATUS_ORDER = { open: 0, running: 1, done: 2 } as const;
const SIZE_PRESETS = [2, 3, 4, 5, 6, 7];
const COURT_PRESETS = [1, 2, 3, 4];

export default function Matches({ state, me, apply, onOpen }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const events = Object.entries(state.events)
    .map(([id, ev]) => ({ id, ...ev }))
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.createdAt.localeCompare(a.createdAt),
    );

  return (
    <>
      <Countdown endsAt={cycleEndsAt(state.cycle)} />
      <PushToggle playerId={me} />
      {showCreate ? (
        <CreateForm
          me={me}
          apply={apply}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            onOpen(id);
          }}
        />
      ) : (
        <button className="btn primary block" type="button" onClick={() => setShowCreate(true)}>
          + Créer un match
        </button>
      )}
      {events.length === 0 ? (
        <p className="empty">Aucun match pour l’instant. Crée le premier !</p>
      ) : (
        <div className="list">
          {events.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              me={me}
              creatorName={state.players[ev.createdBy]?.name}
              onOpen={() => onOpen(ev.id)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="cycle">
      ⏱ Les matchs se remettent à zéro dans <strong>{countdownText(endsAt, now)}</strong>
    </div>
  );
}

interface CreateProps {
  me: string;
  apply: (state: VersionedState) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}

function CreateForm({ me, apply, onClose, onCreated }: CreateProps) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  // Padel : on joue à deux.
  const [teamSize, setTeamSize] = useState('2');
  const [courts, setCourts] = useState(DEFAULT_COURTS);
  const [join, setJoin] = useState(true);
  const [busy, setBusy] = useState(false);
  const placeholder = defaultTitle();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const size = Number(teamSize);
    if (!Number.isInteger(size) || size < MIN_TEAM_SIZE || size > MAX_TEAM_SIZE) {
      return toast(`Le nombre de joueurs par équipe doit être entre ${MIN_TEAM_SIZE} et ${MAX_TEAM_SIZE}.`);
    }
    setBusy(true);
    try {
      const res = await api<{ id: string; state: VersionedState }>('POST', '/api/events', {
        title: title.trim() || placeholder,
        teamSize: size,
        courts,
        join,
        playerId: me,
      });
      apply(res.state);
      toast('Match créé !', 'ok');
      onCreated(res.id);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Nouveau match</h2>
      <label className="field">
        <span>
          Titre <em className="muted">(facultatif)</em>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          maxLength={MAX_TITLE_LENGTH}
          autoFocus
        />
      </label>
      <div className="field">
        <span>Joueurs par équipe</span>
        <div className="presets">
          {SIZE_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className="preset"
              aria-pressed={teamSize === String(n)}
              onClick={() => setTeamSize(String(n))}
            >
              {n}
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            min={MIN_TEAM_SIZE}
            max={MAX_TEAM_SIZE}
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            aria-label="Autre nombre de joueurs par équipe"
            required
          />
        </div>
      </div>
      <div className="field">
        <span>Terrains disponibles</span>
        <div className="presets">
          {COURT_PRESETS.filter((n) => n <= MAX_COURTS).map((n) => (
            <button
              key={n}
              type="button"
              className="preset"
              aria-pressed={courts === n}
              onClick={() => setCourts(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <small className="muted">Autant de rencontres jouées en même temps.</small>
      </div>
      <label className="check">
        <input type="checkbox" checked={join} onChange={(e) => setJoin(e.target.checked)} />
        Je m’inscris directement
      </label>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>
          Créer le match
        </button>
        <button className="btn ghost" type="button" onClick={onClose}>
          Annuler
        </button>
      </div>
    </form>
  );
}

interface CardProps {
  event: MatchEvent & { id: string };
  me: string;
  creatorName?: string;
  onOpen: () => void;
}

function EventCard({ event, me, creatorName, onOpen }: CardProps) {
  const n = event.participants.length;
  const needed = 2 * event.teamSize;
  const mine =
    event.status === 'open'
      ? event.participants.some((p) => p.id === me)
      : event.teams.some((t) => t.members.some((m) => m.id === me)) ||
        event.subs.some((s) => s.id === me);

  let line: string;
  if (event.status === 'open') {
    line = `${plural(n, 'inscrit')} · équipes de ${event.teamSize}`;
    if (n < needed) line += ` · encore ${plural(needed - n, 'joueur')} pour lancer`;
  } else if (event.status === 'running') {
    const { played, total } = progress(event.matches);
    line = `${event.teams.length} équipes · ${played}/${total} rencontres jouées`;
  } else {
    line = event.winner !== null ? `🏆 ${event.teams[event.winner].name}` : 'Terminé';
  }

  // Où en est mon équipe, en une ligne.
  let myLine: string | null = null;
  const status = myStatus(event, teamIndexOf(event, me));
  if (status?.kind === 'play') {
    const opponent = event.teams[status.opponent].name;
    myLine =
      status.court !== null
        ? `⚔ À vous : terrain ${status.court} contre les ${opponent}`
        : `⚔ Contre les ${opponent}, en attente d’un terrain`;
  } else if (status?.kind === 'wait') {
    myLine = '⏳ En attente de votre adversaire';
  } else if (status?.kind === 'eliminated' && event.status === 'running') {
    myLine = `Éliminés · ${placeText(status.place)}`;
  } else if (status?.kind === 'champion') {
    myLine = '🏆 Vous avez gagné';
  }

  return (
    <article
      className={`card event ${event.status}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="event-head">
        <h2>{event.title}</h2>
        <span className={`badge ${event.status}`}>{STATUS_LABELS[event.status]}</span>
      </div>
      <p className="muted small">
        {line}
        {creatorName ? ` · par ${creatorName}` : ''}
      </p>
      {myLine ? <p className="mine-flag">{myLine}</p> : mine && <p className="mine-flag">✓ J’y participe</p>}
    </article>
  );
}
