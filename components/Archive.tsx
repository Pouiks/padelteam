'use client';
/** Onglet Archives : cycles terminés, en lecture seule. */
import { useEffect, useState } from 'react';
import type { ArchiveSummary, Match, Team } from '@/lib/types';
import { STATUS_LABELS } from '@/lib/constants';
import { roundLabel, totalRounds, winnerOf } from '@/lib/bracket';
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

function ArchivedEvent({ event }: { event: ArchiveSummary['events'][number] }) {
  const total = totalRounds(event);
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
          <ul className="archived-teams small">
            {event.teams.map((t) => (
              <li key={t.name}>
                <strong>{t.name}</strong> ({teamSum(t.members)} pts) : {t.members.map((m) => m.name).join(', ')}
              </li>
            ))}
          </ul>
          {event.rounds.map((round, r) => (
            <p key={r} className="small muted">
              <strong>{roundLabel(r, total)}</strong> ·{' '}
              {round.map((m) => describeMatch(m, event.teams)).join(' · ')}
            </p>
          ))}
        </>
      )}
    </article>
  );
}

/** « ✓ Rouges 3-1 Bleus », « Rouges vs ✓ Bleus », « Verts exempts », « Gris vs Roses (non joué) ». */
function describeMatch(m: Match, teams: Team[]): string {
  const a = teams[m.a].name;
  if (m.b === null) return `${a} exempts`;
  const b = teams[m.b].name;
  const winner = winnerOf(m);
  const score = m.sa !== null && m.sb !== null ? `${m.sa}-${m.sb}` : 'vs';
  if (winner === null) return `${a} ${score} ${b} (non joué)`;
  return `${winner === m.a ? '✓ ' : ''}${a} ${score} ${winner === m.b ? '✓ ' : ''}${b}`;
}
