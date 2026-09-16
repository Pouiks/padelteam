'use client';
/**
 * Onglet Archives : cycles terminés, en lecture seule. Les archives antérieures à
 * la double élimination gardent leur ancien tableau (`rounds`) et s'affichent
 * comme avant.
 */
import { useEffect, useState } from 'react';
import type {
  ArchivedEvent as ArchivedEventData,
  ArchiveSummary,
  BracketMatch,
  LegacyMatch,
  Team,
} from '@/lib/types';
import { STATUS_LABELS } from '@/lib/constants';
import { matchLabel, outcomes, teamStatus } from '@/lib/bracket';
import { placeText } from '@/lib/client/tournament';
import { teamSum } from '@/lib/balance';
import { api } from '@/lib/client/api';
import { fmtDateTime, plural } from '@/lib/client/format';

export default function Archive() {
  const [cycles, setCycles] = useState<ArchiveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ArchiveSummary[]>('GET', '/api/archive')
      .then((data) => {
        if (!cancelled) setCycles(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="empty">{error}</p>;
  if (cycles === null) return <p className="center muted">Chargement des archives…</p>;
  if (cycles.length === 0) {
    return (
      <p className="empty">
        Aucune archive pour l’instant. Les matchs des cycles terminés apparaîtront ici.
      </p>
    );
  }

  return (
    <>
      {cycles.map((c) => (
        <section key={c.id} className="card archive-cycle">
          <h2>
            Du {fmtDateTime(c.startedAt)} au {fmtDateTime(c.endedAt)}
          </h2>
          {c.events.length === 0 ? (
            <p className="muted small">Aucun match.</p>
          ) : (
            c.events.map((ev) => <ArchivedEvent key={ev.id} event={ev} />)
          )}
        </section>
      ))}
    </>
  );
}

function ArchivedEvent({ event }: { event: ArchivedEventData }) {
  const winner = event.status === 'done' && event.winner !== null ? event.teams[event.winner] : null;

  return (
    <article className="archived">
      <div className="event-head">
        <h3>{event.title}</h3>
        <span className={`badge ${event.status}`}>{STATUS_LABELS[event.status]}</span>
      </div>
      {event.status === 'open' ? (
        <p className="muted small">
          {plural(event.participants.length, 'inscrit')} · équipes de {event.teamSize} · jamais lancé
        </p>
      ) : (
        <>
          {winner && (
            <p className="winner-line">
              🏆 {winner.name} — {winner.members.map((m) => m.name).join(', ')}
            </p>
          )}
          {event.matches ? (
            <DoubleElimination teams={event.teams} matches={event.matches} />
          ) : (
            <LegacyBracket teams={event.teams} rounds={event.rounds ?? []} />
          )}
        </>
      )}
    </article>
  );
}

/** Classement et rencontres jouées d'un tournoi à double élimination. */
function DoubleElimination({ teams, matches }: { teams: Team[]; matches: BracketMatch[] }) {
  const out = outcomes(matches);
  const ranked = teams
    .map((team, i) => {
      const s = teamStatus({ teams, matches }, i, out);
      return { team, place: s.kind === 'champion' ? 1 : s.kind === 'eliminated' ? s.place : null };
    })
    .sort((x, y) => (x.place ?? 99) - (y.place ?? 99));

  const played = out.flatMap((o, i) => {
    if (o.state !== 'done') return [];
    const a = teams[o.a as number].name;
    const b = teams[o.b as number].name;
    const m = matches[i];
    const score = m.sa !== null && m.sb !== null ? `${m.sa}-${m.sb}` : 'vs';
    return [`${matchLabel(matches, i)} : ${o.winner === o.a ? '✓ ' : ''}${a} ${score} ${o.winner === o.b ? '✓ ' : ''}${b}`];
  });

  return (
    <>
      <ul className="archived-teams small">
        {ranked.map(({ team, place }) => (
          <li key={team.name}>
            {place !== null && <strong>{placeText(place)} · </strong>}
            <strong>{team.name}</strong> ({teamSum(team.members)} pts) : {team.members.map((m) => m.name).join(', ')}
          </li>
        ))}
      </ul>
      {played.map((line) => (
        <p key={line} className="small muted">
          {line}
        </p>
      ))}
    </>
  );
}

/** Ancien tableau à élimination simple, tel qu'il a été archivé. */
function LegacyBracket({ teams, rounds }: { teams: Team[]; rounds: LegacyMatch[][] }) {
  const total = rounds[0]?.length ? Math.round(Math.log2(rounds[0].length)) + 1 : 0;
  const label = (r: number) => {
    const fromEnd = total - 1 - r;
    if (fromEnd === 0) return 'Finale';
    if (fromEnd === 1) return 'Demi-finales';
    if (fromEnd === 2) return 'Quarts de finale';
    return `Tour ${r + 1}`;
  };

  return (
    <>
      <ul className="archived-teams small">
        {teams.map((t) => (
          <li key={t.name}>
            <strong>{t.name}</strong> ({teamSum(t.members)} pts) : {t.members.map((m) => m.name).join(', ')}
          </li>
        ))}
      </ul>
      {rounds.map((round, r) => (
        <p key={r} className="small muted">
          <strong>{label(r)}</strong> · {round.map((m) => describeLegacy(m, teams)).join(' · ')}
        </p>
      ))}
    </>
  );
}

/** « ✓ Rouges 3-1 Bleus », « Rouges vs ✓ Bleus », « Verts exempts », « Gris vs Roses (non joué) ». */
function describeLegacy(m: LegacyMatch, teams: Team[]): string {
  const a = teams[m.a].name;
  if (m.b === null) return `${a} exempts`;
  const b = teams[m.b].name;
  let winner = m.winner;
  if (winner === null && m.sa !== null && m.sb !== null && m.sa !== m.sb) winner = m.sa > m.sb ? m.a : m.b;
  const score = m.sa !== null && m.sb !== null ? `${m.sa}-${m.sb}` : 'vs';
  if (winner === null) return `${a} ${score} ${b} (non joué)`;
  return `${winner === m.a ? '✓ ' : ''}${a} ${score} ${winner === m.b ? '✓ ' : ''}${b}`;
}
