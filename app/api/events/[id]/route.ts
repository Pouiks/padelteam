/** DELETE /api/events/:id → supprime un match du cycle courant. */
import { getStore } from '@/lib/db';
import { cleanId, getEvent, handle, json } from '@/lib/api';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const { id: rawId } = await ctx.params;
    const id = cleanId(rawId, 'de match');
    const { state } = await getStore().mutate((s) => {
      getEvent(s, id);
      delete s.events[id];
    });
    return json({ ok: true, state });
  });
}
