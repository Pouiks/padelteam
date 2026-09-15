/** GET /api/archive → cycles archivés, du plus récent au plus ancien. */
import { getStore } from '@/lib/db';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handle(async () => json(await getStore().listArchive()));
}
