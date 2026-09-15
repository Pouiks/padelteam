'use client';
/**
 * Fiche d'un match : inscriptions, puis équipes et tableau une fois lancé.
 * Après le tirage, chacun voit toutes les rencontres et la sienne en tête, et
 * déclare le vainqueur de son match d'un geste (score facultatif).
 */
import { useState, type ReactNode } from 'react';
import type { Match, MatchEvent, VersionedState } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/constants';
import { latestMatchOf, roundLabel, teamIndexOf, totalRounds, winnerOf } from '@/lib/bracket';
import { teamSum } from '@/lib/balance';
import { api } from '@/lib/client/api';
import { fmtDateTime, plural } from '@/lib/client/format';
import { useToast } from './Toasts';

interface Props {
  id: string;
  event: MatchEvent;
  state: VersionedState;
  me: string;
  apply: (state: VersionedState) => void;
  onBack: () => void;
}

interface ResultPayload {
  round: number;
  match: number;
  winner: number;
  sa?: number;
  sb?: number;
}

type SaveResult = (payload: ResultPayload) => Promise<void>;

export default function EventDetail({ id, event, state, me, apply, onBack }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const base = `/api/events/${encodeURIComponent(id)}`;
  const creator = state.players[event.createdBy]?.name ?? 'quelqu’un';

  /** Appelle l'API, applique l'état renvoyé, affiche les erreurs. */
  async function call<T extends { state: VersionedState }>(
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    setBusy(true);
    try {
      const res = await api<T>(method, path, body);
      apply(res.state);
      return res;
    } catch (err) {
      toast((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggleJoin() {
    const res = await call<{ joined: boolean; state: VersionedState }>('POST', `${base}/join`, {
      playerId: me,
    });
    if (res) toast(res.joined ? 'Inscription enregistrée.' : 'Tu es retiré·e du match.', 'ok');
  }

  async function launch() {
    const res = await call('POST', `${base}/launch`);
    if (res) toast('Équipes formées, que le meilleur gagne !', 'ok');
  }

  async function reopen() {
    if (!confirm('Rouvrir les inscriptions ? Les équipes, le tableau et les résultats seront effacés.')) return;
    const res = await call('POST', `${base}/reopen`);
    if (res) toast('Inscriptions rouvertes.', 'ok');
  }

  async function remove() {
    if (!confirm(`Supprimer « ${event.title} » ? Cette action est définitive.`)) return;
    setBusy(true);
    try {
      const res = await api<{ state: VersionedState }>('DELETE', base);
      onBack();
      apply(res.state);
      toast('Match supprimé.', 'ok');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Utilisé par chaque rencontre ; propage l'erreur pour l'afficher au bon endroit. */
  const saveResult: SaveResult = async (payload) => {
    const res = await api<{ state: VersionedState }>('POST', `${base}/result`, payload);
    apply(res.state);
  };

  return (
    <>
      <button className="link back" type="button" onClick={onBack}>
        ← Matchs
      </button>
      <div className="event-head">
        <h1>{event.title}</h1>
        <span className={`badge ${event.status}`}>{STATUS_LABELS[event.status]}</span>
      </div>
      <p className="muted small">
        Équipes de {event.teamSize} · proposé par {creator} · {fmtDateTime(event.createdAt)}
      </p>

      {event.status === 'open' ? (
        <OpenView event={event} me={me} busy={busy} onJoin={toggleJoin} onLaunch={launch} onDelete={remove} />
      ) : (
        <RunningView event={event} me={me} busy={busy} onSave={saveResult} onReopen={reopen} onDelete={remove} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inscriptions ouvertes
// ---------------------------------------------------------------------------

interface OpenProps {
  event: MatchEvent;
  me: string;
  busy: boolean;
  onJoin: () => void;
  onLaunch: () => void;
  onDelete: () => void;
}

function OpenView({ event, me, busy, onJoin, onLaunch, onDelete }: OpenProps) {
  const n = event.participants.length;
  const needed = 2 * event.teamSize;
  const nTeams = Math.floor(n / event.teamSize);
  const subs = n - nTeams * event.teamSize;
  const mine = event.participants.some((p) => p.id === me);

  const info =
    n < needed
      ? `Encore ${plural(needed - n, 'joueur')} pour pouvoir lancer.`
      : `${nTeams} équipes de ${event.teamSize}${subs ? ` + ${plural(subs, 'remplaçant')}` : ''}.`;

  return (
    <section className="card">
      <h2>{plural(n, 'inscrit')}</h2>
      <div className="chips">
        {n === 0 ? (
          <span className="muted small">Personne pour l’instant.</span>
        ) : (
          event.participants.map((p) => (
            <span key={p.id} className={`chip ${p.id === me ? 'me' : ''}`}>
              {p.name}
              <small>{p.level}</small>
            </span>
          ))
        )}
      </div>
      <p className="muted small">{info}</p>
      <div className="actions">
        <button className={`btn block ${mine ? '' : 'primary'}`} type="button" disabled={busy} onClick={onJoin}>
          {mine ? 'Je me retire' : 'Je participe'}
        </button>
        <button className="btn primary block" type="button" disabled={busy || n < needed} onClick={onLaunch}>
          Former les équipes et lancer
        </button>
        <button className="btn danger ghost block" type="button" disabled={busy} onClick={onDelete}>
          Supprimer ce match
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Match lancé : mon match, équipes, tableau
// ---------------------------------------------------------------------------

interface RunningProps {
  event: MatchEvent;
  me: string;
  busy: boolean;
  onSave: SaveResult;
  onReopen: () => void;
  onDelete: () => void;
}

function RunningView({ event, me, busy, onSave, onReopen, onDelete }: RunningProps) {
  const total = totalRounds(event);
  const myTeam = teamIndexOf(event, me);
  const winner = event.status === 'done' && event.winner !== null ? event.teams[event.winner] : null;
  const isSub = event.subs.some((s) => s.id === me);

  return (
    <>
      {winner && (
        <div className="banner">
          <div className="banner-title">🏆 Vainqueurs : {winner.name}</div>
          <div className="small">{winner.members.map((m) => m.name).join(', ')}</div>
        </div>
      )}

      {myTeam !== null && <MyMatch event={event} myTeam={myTeam} onSave={onSave} />}
      {isSub && <p className="hint">Tu es remplaçant·e sur ce match : tu peux quand même déclarer les résultats.</p>}

      <section className="card">
        <h2>Équipes</h2>
        <div className="teams">
          {event.teams.map((team, i) => {
            const mine = i === myTeam;
            const won = event.status === 'done' && event.winner === i;
            return (
              <div key={team.name} className={`team ${mine ? 'mine' : ''} ${won ? 'winner' : ''}`}>
                <div className="team-head">
                  <strong>{team.name}</strong>
                  <span className="sum">{teamSum(team.members)} pts</span>
                </div>
                <ul>
                  {team.members.map((m) => (
                    <li key={m.id} className={m.id === me ? 'me' : undefined}>
                      <span>{m.name}</span>
                      <span className="lvl">{m.level}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {event.subs.length > 0 && (
          <p className="subs small">
            <strong>Remplaçants :</strong> {event.subs.map((s) => `${s.name} (${s.level})`).join(', ')}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Toutes les rencontres</h2>
        <p className="muted small">
          Chaque équipe déclare le vainqueur de sa rencontre ; le tour suivant se remplit tout seul.
        </p>
        {event.rounds.map((round, r) => (
          <div key={r} className="round">
            <h3>{roundLabel(r, total)}</h3>
            {round.map((m, i) => (
              <MatchRow key={`${r}-${i}`} event={event} round={r} index={i} match={m} myTeam={myTeam} onSave={onSave} />
            ))}
          </div>
        ))}
      </section>

      <div className="actions">
        <button className="btn ghost block" type="button" disabled={busy} onClick={onReopen}>
          Rouvrir les inscriptions
        </button>
        <button className="btn danger ghost block" type="button" disabled={busy} onClick={onDelete}>
          Supprimer ce match
        </button>
      </div>
    </>
  );
}

/** Encart « Mon match » : la rencontre la plus avancée de mon équipe. */
function MyMatch({ event, myTeam, onSave }: { event: MatchEvent; myTeam: number; onSave: SaveResult }) {
  const located = latestMatchOf(event, myTeam);
  if (!located) return null;
  const { round, index, match } = located;
  const label = roundLabel(round, totalRounds(event));
  const stage = label.toLowerCase();
  const teamName = event.teams[myTeam].name;

  let body: ReactNode;
  if (event.status === 'done' && event.winner === myTeam) {
    body = <p className="my-status win">🏆 Vous avez remporté le tournoi avec les {teamName} !</p>;
  } else if (match.b === null) {
    body = <p className="my-status">Exempts en {stage} : vous attendez le tour suivant.</p>;
  } else {
    const result = winnerOf(match);
    const opponent = event.teams[match.a === myTeam ? match.b : match.a].name;
    if (result === null) {
      body = (
        <>
          <p className="my-status">
            {label} contre les <strong>{opponent}</strong>.
          </p>
          <MatchRow event={event} round={round} index={index} match={match} myTeam={myTeam} onSave={onSave} prominent />
        </>
      );
    } else if (result === myTeam) {
      body = (
        <p className="my-status win">
          Victoire en {stage} contre les {opponent}
          {scoreText(match)} ! En attente des autres rencontres.
        </p>
      );
    } else {
      body = (
        <p className="my-status lost">
          Éliminés en {stage} par les {opponent}
          {scoreText(match)}.
        </p>
      );
    }
  }

  return (
    <section className="card my-match">
      <h2>Mon match · {teamName}</h2>
      {body}
    </section>
  );
}

function scoreText(match: Match): string {
  return match.sa !== null && match.sb !== null ? ` (${match.sa}-${match.sb})` : '';
}

interface RowProps {
  event: MatchEvent;
  round: number;
  index: number;
  match: Match;
  myTeam: number | null;
  onSave: SaveResult;
  /** Version mise en avant dans l'encart « Mon match ». */
  prominent?: boolean;
}

function MatchRow({ event, round, index, match, myTeam, onSave, prominent }: RowProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [withScore, setWithScore] = useState(false);
  const [sa, setSa] = useState('');
  const [sb, setSb] = useState('');
  const [saving, setSaving] = useState(false);

  const mine = myTeam !== null && (match.a === myTeam || match.b === myTeam);
  const cls = `match${mine ? ' mine' : ''}${prominent ? ' prominent' : ''}`;
  const nameA = event.teams[match.a].name;

  if (match.b === null) {
    return (
      <div className={`${cls} bye`}>
        <span className="tname">{nameA}</span>
        <span className="muted small">exempts · qualifiés d’office</span>
      </div>
    );
  }
  const teamB = match.b;
  const nameB = event.teams[teamB].name;
  const result = winnerOf(match);
  const hasScore = match.sa !== null && match.sb !== null;

  if (result !== null && !editing) {
    return (
      <div className={`${cls} resolved`}>
        <span className={`tname ${result === match.a ? 'win' : 'lost'}`}>
          {result === match.a ? '✓ ' : ''}
          {nameA}
        </span>
        <span className="score">{hasScore ? `${match.sa} – ${match.sb}` : 'vs'}</span>
        <span className={`tname right ${result === teamB ? 'win' : 'lost'}`}>
          {nameB}
          {result === teamB ? ' ✓' : ''}
        </span>
        <button
          className="link"
          type="button"
          onClick={() => {
            setWithScore(hasScore);
            setSa(hasScore ? String(match.sa) : '');
            setSb(hasScore ? String(match.sb) : '');
            setEditing(true);
          }}
        >
          corriger
        </button>
      </div>
    );
  }

  async function submit(payload: Omit<ResultPayload, 'round' | 'match'>) {
    setSaving(true);
    try {
      await onSave({ round, match: index, ...payload });
      setEditing(false);
      setWithScore(false);
      setSa('');
      setSb('');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function submitScore() {
    const a = Number.parseInt(sa, 10);
    const b = Number.parseInt(sb, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return toast('Saisis les deux scores.');
    if (a === b) return toast('Égalité interdite : il faut un vainqueur.');
    void submit({ winner: a > b ? match.a : teamB, sa: a, sb: b });
  }

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 3);

  return (
    <div className={`${cls} entry`}>
      {withScore ? (
        <>
          <label className="line">
            <span className="tname">{nameA}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sa}
              onChange={(e) => setSa(digits(e.target.value))}
              placeholder="0"
              aria-label={`Score ${nameA}`}
            />
          </label>
          <label className="line">
            <span className="tname">{nameB}</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sb}
              onChange={(e) => setSb(digits(e.target.value))}
              placeholder="0"
              aria-label={`Score ${nameB}`}
            />
          </label>
          <div className="row">
            <button className="btn primary small" type="button" disabled={saving} onClick={submitScore}>
              Valider le score
            </button>
            <button
              className="btn ghost small"
              type="button"
              onClick={() => {
                setWithScore(false);
                setEditing(false);
              }}
            >
              Annuler
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="entry-hint small muted">{mine ? 'Qui a gagné votre match ?' : 'Qui a gagné ?'}</p>
          <div className="win-buttons">
            <button className="btn win-btn" type="button" disabled={saving} onClick={() => void submit({ winner: match.a })}>
              ✓ {nameA}
            </button>
            <span className="vs">vs</span>
            <button className="btn win-btn" type="button" disabled={saving} onClick={() => void submit({ winner: teamB })}>
              ✓ {nameB}
            </button>
          </div>
          <div className="row links">
            <button className="link" type="button" onClick={() => setWithScore(true)}>
              saisir le score
            </button>
            {editing && (
              <button className="link" type="button" onClick={() => setEditing(false)}>
                annuler
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
