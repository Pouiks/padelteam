/**
 * GET /api/cron/rotate → force la vérification du cycle de 48 h.
 * Appelé par le cron Vercel (vercel.json). La rotation est de toute façon
 * effectuée paresseusement à chaque requête : ce cron sert juste à archiver
 * un cycle expiré même si personne n'ouvre l'application.
 */
import { getStore } from '@/lib/db';
import { checkCronSecret, handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handle(async () => {
    checkCronSecret(req);
    const rotated = await getStore().rotateIfNeeded();
    return json({ rotated });
  });
}
