/** GET /api/push/config → { enabled, publicKey } (clé publique VAPID pour s'abonner). */
import { vapidPublicKey } from '@/lib/push';
import { handle, json } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const publicKey = vapidPublicKey();
    return json({ enabled: publicKey !== null, publicKey });
  });
}
