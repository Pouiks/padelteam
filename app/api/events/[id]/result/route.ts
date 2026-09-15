/**
 * POST /api/events/:id/result  { round, match, winner?, sa?, sb? }
 * Déclare ou corrige le résultat d'une rencontre : `winner` est l'index de
 * l'équipe gagnante ; le score est facultatif (et suffit à lui seul).
 * Les tours suivants sont recalculés.
 */
import { getStore } from '@/lib/db';
import { setResult } from '@/lib/bracket';
import { cleanId, cleanIndex, cleanScore, getEvent, handle, json, readJson } from '@/lib/api';

function optionalScore(value: unknown, what: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return cleanScore(value, what);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id: rawId } = await ctx.params;
    const id = cleanId(rawId, 'de match');
    const body = await readJson(req);
    const round = cleanIndex(body.round, 'de tour');
    const match = cleanIndex(body.match, 'de rencontre');
    const winner =
      body.winner === undefined || body.winner === null ? null : cleanIndex(body.winner, 'd’équipe gagnante');
    const sa = optionalScore(body.sa, 'de la première équipe');
    const sb = optionalScore(body.sb, 'de la seconde équipe');

    const { state } = await getStore().mutate((s) => {
      setResult(getEvent(s, id), round, match, { winner, sa, sb });
    });
    return json({ ok: true, state });
  });
}
