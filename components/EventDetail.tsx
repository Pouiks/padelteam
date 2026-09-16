'use client';
/**
 * Fiche d'un match : inscriptions, puis équipes et tournoi à double élimination
 * une fois lancé. En tête, chacun voit ce que son équipe doit faire — terrain,
 * adversaire, ou qui elle attend. Viennent ensuite les rencontres en cours sur
 * les terrains, les équipes et le tableau complet. N'importe qui peut déclarer
 * un résultat : la première équipe qui le souhaite.
 */
import { useState, type ReactNode } from 'react';
import type { BracketSide, MatchEvent, VersionedState } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/constants';
import { matchLabel, outcomes, progress, teamIndexOf, teamStatus, type Outcome } from '@/lib/bracket';
import { teamSum } from '@/lib/balance';
import { api } from '@/lib/client/api';
import { fmtDateTime, plural } from '@/lib/client/format';
import { myStatus, placeText, slotText, statusMessage, statusSignature } from '@/lib/client/tournament';
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

  /**
   * Utilisé par chaque rencontre ; propage l'erreur pour l'afficher au bon endroit.
   * Quand la situation de mon équipe change, useTournamentAlerts annonce déjà la
   * suite (« À vous ! Terrain 2… ») : on ne confirme sobrement que dans les autres cas.
   */
  const saveResult: SaveResult = async (payload) => {
    const res = await api<{ state: VersionedState }>('POST', `${base}/result`, payload);
    const myTeam = teamIndexOf(event, me);
    const before = myStatus(event, myTeam);
    const updated = res.state.events[id];
    const after = updated ? myStatus(updated, myTeam) : null;
    apply(res.state);
    if (!before || !after || statusSignature(before) === statusSignature(after)) {
      toast('Résultat enregistré.', 'ok');
    }
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
        Équipes de {event.teamSize} · {plural(event.courts, 'terrain')} · proposé par {creator} ·{' '}
        {fmtDateTime(event.createdAt)}
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
      : `${nTeams} équipes de ${event.teamSize}${subs ? ` + ${plural(subs, 'remplaçant')}` : ''}, tournoi à double élimination.`;

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
// Tournoi lancé
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
  const out = outcomes(event.matches);
  const myTeam = teamIndexOf(event, me);
  const status = myStatus(event, myTeam);
  const isSub = event.subs.some((s) => s.id === me);
  const champion = event.status === 'done' && event.winner !== null ? event.teams[event.winner] : null;
  const myMatch = status?.kind === 'play' ? status.match : null;

  return (
    <>
      {champion && (
        <div className="banner">
          <div className="banner-title">🏆 Vainqueurs : {champion.name}</div>
          <div className="small">{champion.members.map((m) => m.name).join(', ')}</div>
        </div>
      )}

      {myTeam !== null && status && (
        <MyTeam event={event} out={out} team={myTeam} status={status} onSave={onSave} />
      )}
      {isSub && <p className="hint">Tu es remplaçant·e sur ce match : tu peux quand même déclarer les résultats.</p>}
      {myTeam === null && !isSub && event.status !== 'done' && (
        <p className="hint">
          Tu ne joues pas ce match. Cette page se met à jour toute seule dès qu’une équipe déclare
          son résultat — rien à rafraîchir.
        </p>
      )}

      <OnCourts event={event} out={out} myTeam={myTeam} exclude={myMatch} onSave={onSave} />
      <Teams event={event} out={out} me={me} myTeam={myTeam} />
      <Bracket event={event} out={out} myTeam={myTeam} onSave={onSave} />

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

type Status = NonNullable<ReturnType<typeof myStatus>>;

/** Encart « Mon équipe » : ce qu'elle doit faire maintenant, vu par ses joueurs. */
function MyTeam({
  event,
  out,
  team,
  status,
  onSave,
}: {
  event: MatchEvent;
  out: Outcome[];
  team: number;
  status: Status;
  onSave: SaveResult;
}) {
  const name = event.teams[team].name;
  const alive = status.kind === 'play' || status.kind === 'wait';

  let body: ReactNode;
  switch (status.kind) {
    case 'champion':
      body = <p className="my-status win">🏆 Vous avez remporté le tournoi avec les {name} !</p>;
      break;
    case 'eliminated':
      body = <p className="my-status lost">Éliminés — {placeText(status.place)} place.</p>;
      break;
    case 'play':
      body = (
        <>
          <p className="my-status">
            {status.court !== null ? (
              <span className="court">Terrain {status.court}</span>
            ) : (
              <span className="court waiting">En attente d’un terrain</span>
            )}{' '}
            {matchLabel(event.matches, status.match)} contre les{' '}
            <strong>{event.teams[status.opponent].name}</strong>.
          </p>
          <MatchRow event={event} out={out} index={status.match} myTeam={team} onSave={onSave} prominent />
        </>
      );
      break;
    case 'wait':
      body = <p className="my-status">{statusMessage(event, status)}</p>;
      break;
  }

  return (
    <section className="card my-match">
      <div className="my-head">
        <h2>Mon équipe · {name}</h2>
        {alive && (
          <span className={`lives ${status.losses > 0 ? 'last' : ''}`}>
            {status.losses === 0 ? 'Aucune défaite' : 'Une défaite · dernière chance'}
          </span>
        )}
      </div>
      {body}
    </section>
  );
}

/** Rencontres à jouer maintenant, terrain par terrain, puis celles qui attendent un terrain. */
function OnCourts({
  event,
  out,
  myTeam,
  exclude,
  onSave,
}: {
  event: MatchEvent;
  out: Outcome[];
  myTeam: number | null;
  exclude: number | null;
  onSave: SaveResult;
}) {
  const live = out.flatMap((o, i) => (o.state === 'ready' && i !== exclude ? [i] : []));
  if (live.length === 0) return null;
  const onCourt = live
    .filter((i) => event.matches[i].court !== null)
    .sort((x, y) => (event.matches[x].court as number) - (event.matches[y].court as number));
  const waiting = live.filter((i) => event.matches[i].court === null);

  return (
    <section className="card">
      <h2>{exclude !== null ? 'Sur les autres terrains' : 'Sur les terrains'}</h2>
      {onCourt.map((i) => (
        <div key={i} className="court-block">
          <h3>
            <span className="court">Terrain {event.matches[i].court}</span> {matchLabel(event.matches, i)}
          </h3>
          <MatchRow event={event} out={out} index={i} myTeam={myTeam} onSave={onSave} />
        </div>
      ))}
      {waiting.length > 0 && (
        <div className="court-block">
          <h3>
            <span className="court waiting">En attente d’un terrain</span>
          </h3>
          {waiting.map((i) => (
            <MatchRow key={i} event={event} out={out} index={i} myTeam={myTeam} onSave={onSave} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Les équipes tirées, avec leur parcours : défaites, élimination, titre. */
function Teams({ event, out, me, myTeam }: { event: MatchEvent; out: Outcome[]; me: string; myTeam: number | null }) {
  return (
    <section className="card">
      <h2>Équipes</h2>
      <div className="teams">
        {event.teams.map((team, i) => {
          const s = teamStatus(event, i, out);
          const tag =
            s.kind === 'champion'
              ? '🏆 Vainqueurs'
              : s.kind === 'eliminated'
                ? `Éliminés · ${placeText(s.place)}`
                : s.losses === 1
                  ? '1 défaite'
                  : null;
          const cls = ['team', i === myTeam && 'mine', s.kind === 'champion' && 'winner', s.kind === 'eliminated' && 'out']
            .filter(Boolean)
            .join(' ');
          return (
            <div key={team.name} className={cls}>
              <div className="team-head">
                <strong>{team.name}</strong>
                <span className="sum">{teamSum(team.members)} pts</span>
              </div>
              {tag && <div className={`team-tag${s.losses === 1 && s.kind !== 'eliminated' ? ' warn' : ''}`}>{tag}</div>}
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
  );
}

const SIDES: Array<[BracketSide, string]> = [
  ['winners', 'Tableau des gagnants'],
  ['losers', 'Tableau des perdants'],
  ['final', 'Finale'],
];

/** Le tableau complet, tableau par tableau et tour par tour. */
function Bracket({
  event,
  out,
  myTeam,
  onSave,
}: {
  event: MatchEvent;
  out: Outcome[];
  myTeam: number | null;
  onSave: SaveResult;
}) {
  const { played, total } = progress(event.matches, out);

  // Exempts du premier tour affichés (on sait qui passe) ; les places vides
  // chez les perdants et la revanche inutile n'apportent rien à l'écran.
  const visible = (i: number) => {
    const o = out[i];
    const m = event.matches[i];
    if (o.state === 'skipped') return false;
    if (o.state === 'walkover') return m.side === 'winners' && m.round === 0;
    if (m.reset && o.state === 'pending') return false;
    return true;
  };

  return (
    <section className="card">
      <h2>Tableau</h2>
      <p className="muted small">
        {played}/{total} rencontres jouées. Une défaite envoie dans le tableau des perdants ; la
        deuxième élimine.
      </p>
      {SIDES.map(([side, title]) => {
        const rounds = new Map<number, number[]>();
        event.matches.forEach((m, i) => {
          if (m.side !== side || !visible(i)) return;
          rounds.set(m.round, [...(rounds.get(m.round) ?? []), i]);
        });
        if (rounds.size === 0) return null;
        return (
          <div key={side} className={`bracket-side ${side}`}>
            <h3>{title}</h3>
            {[...rounds.values()].map((indices) => (
              <div key={indices[0]} className="round">
                {side !== 'final' && <h4>{matchLabel(event.matches, indices[0])}</h4>}
                {indices.map((i) => (
                  <MatchRow key={i} event={event} out={out} index={i} myTeam={myTeam} onSave={onSave} compact />
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}

function scoreText(sa: number | null, sb: number | null): string {
  return sa !== null && sb !== null ? `${sa} – ${sb}` : 'vs';
}

interface RowProps {
  event: MatchEvent;
  out: Outcome[];
  index: number;
  myTeam: number | null;
  onSave: SaveResult;
  /** Version mise en avant dans l'encart « Mon équipe ». */
  prominent?: boolean;
  /**
   * Version du tableau : une rencontre à jouer y est seulement annoncée, ses
   * boutons sont déjà en haut de page (« Mon équipe » ou « Sur les terrains »).
   */
  compact?: boolean;
}

function MatchRow({ event, out, index, myTeam, onSave, prominent, compact }: RowProps) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [withScore, setWithScore] = useState(false);
  const [sa, setSa] = useState('');
  const [sb, setSb] = useState('');
  const [saving, setSaving] = useState(false);

  const match = event.matches[index];
  const o = out[index];
  const mine = myTeam !== null && (o.a === myTeam || o.b === myTeam);
  const cls = `match${mine ? ' mine' : ''}${prominent ? ' prominent' : ''}`;

  if (o.state === 'walkover') {
    return (
      <div className={`${cls} bye`}>
        <span className="tname">{slotText(event, out, index, typeof o.a === 'number' ? 'a' : 'b')}</span>
        <span className="muted small">exempts · qualifiés d’office</span>
      </div>
    );
  }

  if (o.state === 'pending' || o.state === 'skipped') {
    return (
      <div className={`${cls} pending`}>
        <span className="tname">{slotText(event, out, index, 'a')}</span>
        <span className="score">vs</span>
        <span className="tname right">{slotText(event, out, index, 'b')}</span>
      </div>
    );
  }

  const teamA = o.a as number;
  const teamB = o.b as number;
  const nameA = event.teams[teamA].name;
  const nameB = event.teams[teamB].name;

  if (o.state === 'ready' && compact) {
    return (
      <div className={`${cls} upcoming`}>
        <span className="tname">{nameA}</span>
        <span className="score">vs</span>
        <span className="tname right">{nameB}</span>
        <span className="upcoming-where">
          {match.court !== null ? (
            <span className="court">Terrain {match.court}</span>
          ) : (
            <span className="court waiting">En attente d’un terrain</span>
          )}
        </span>
      </div>
    );
  }

  if (o.state === 'done' && !editing) {
    const hasScore = match.sa !== null && match.sb !== null;
    return (
      <div className={`${cls} resolved`}>
        <span className={`tname ${o.winner === teamA ? 'win' : 'lost'}`}>
          {o.winner === teamA ? '✓ ' : ''}
          {nameA}
        </span>
        <span className="score">{scoreText(match.sa, match.sb)}</span>
        <span className={`tname right ${o.winner === teamB ? 'win' : 'lost'}`}>
          {nameB}
          {o.winner === teamB ? ' ✓' : ''}
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

  async function submit(payload: Omit<ResultPayload, 'match'>) {
    setSaving(true);
    try {
      await onSave({ match: index, ...payload });
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
    void submit({ winner: a > b ? teamA : teamB, sa: a, sb: b });
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
            {editing && (
              <button className="btn ghost small" type="button" onClick={() => setEditing(false)}>
                Annuler
              </button>
            )}
          </div>
          <div className="row links">
            <button className="link" type="button" onClick={() => setWithScore(false)}>
              sans score, juste le vainqueur
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="entry-hint small muted">{mine ? 'Qui a gagné votre match ?' : 'Qui a gagné ?'}</p>
          <div className="win-buttons">
            <button className="btn win-btn" type="button" disabled={saving} onClick={() => void submit({ winner: teamA })}>
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
