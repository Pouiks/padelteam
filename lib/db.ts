/**
 * Choix du stockage à l'exécution :
 *  - Upstash Redis si les variables d'environnement sont présentes (Vercel) ;
 *  - sinon, fichiers JSON dans data/ (développement local).
 *
 * L'instance est mémorisée sur `globalThis` pour survivre aux rechargements à
 * chaud du serveur de développement Next.js.
 */
import path from 'node:path';
import { FileKV } from './kv.ts';
import { upstashFromEnv } from './kv-upstash.ts';
import { Store } from './store.ts';

/**
 * Le stockage n'est pas utilisable. Sur Vercel, le disque du projet est en
 * lecture seule et /tmp est éphémère : sans base Redis, tout serait perdu au
 * rechargement suivant. Mieux vaut une erreur visible qu'une perte silencieuse.
 */
export class StorageError extends Error {
  name = 'StorageError';
}

declare global {
  // eslint-disable-next-line no-var
  var __vestiaireStore: Store | undefined;
}

export function getStore(): Store {
  if (globalThis.__vestiaireStore) return globalThis.__vestiaireStore;

  const upstash = upstashFromEnv();
  if (upstash) {
    globalThis.__vestiaireStore = new Store(upstash);
    return globalThis.__vestiaireStore;
  }

  if (process.env.VERCEL) {
    throw new StorageError(
      'Aucune base Upstash Redis configurée : les données ne seraient pas conservées. ' +
        'Ajoutez « Upstash for Redis » dans l’onglet Storage du projet Vercel, puis redéployez.',
    );
  }

  const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  globalThis.__vestiaireStore = new Store(new FileKV(dir));
  return globalThis.__vestiaireStore;
}
