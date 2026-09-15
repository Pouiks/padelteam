/**
 * Choix du stockage à l'exécution :
 *  - Upstash Redis si les variables d'environnement sont présentes (Vercel) ;
 *  - sinon, fichiers JSON dans data/ (développement local).
 *
 * L'instance est mémorisée sur `globalThis` pour survivre aux rechargements à
 * chaud du serveur de développement Next.js.
 */
import path from 'node:path';
import os from 'node:os';
import { FileKV } from './kv.ts';
import { upstashFromEnv } from './kv-upstash.ts';
import { Store } from './store.ts';

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

  let dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  if (process.env.VERCEL) {
    // Sur Vercel, le système de fichiers du projet est en lecture seule et /tmp
    // est éphémère : l'application fonctionne, mais les données seront perdues.
    dir = path.join(os.tmpdir(), 'vestiaire-data');
    console.warn(
      '[vestiaire] Aucune base Upstash Redis configurée : les données ne seront PAS conservées. ' +
        'Ajoutez « Upstash for Redis » dans l’onglet Storage du projet Vercel.',
    );
  }
  globalThis.__vestiaireStore = new Store(new FileKV(dir));
  return globalThis.__vestiaireStore;
}
