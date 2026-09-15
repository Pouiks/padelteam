/**
 * Abstraction minimale de stockage clé/valeur, limitée aux primitives dont
 * l'application a besoin. Trois implémentations :
 *  - MemoryKV  : en mémoire (tests) ;
 *  - FileKV    : fichiers JSON dans data/ (développement local, hors Vercel) ;
 *  - UpstashKV : Redis Upstash via REST (production sur Vercel), voir kv-upstash.ts.
 *
 * Toutes les valeurs sont des chaînes (du JSON sérialisé par l'appelant).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface KV {
  /** Lit une valeur, ou null si la clé n'existe pas. */
  get(key: string): Promise<string | null>;
  /** Écrit une valeur sans condition. */
  set(key: string, value: string): Promise<void>;
  /**
   * Écriture conditionnelle atomique (compare-and-set) : n'écrit `value` sous
   * `key` que si la version stockée sous `versionKey` vaut `expected`, puis
   * remplace la version par `next`. Renvoie false si quelqu'un a écrit entre-temps.
   */
  cas(key: string, versionKey: string, expected: number, next: number, value: string): Promise<boolean>;
  /** Liste les clés qui commencent par `prefix` (le préfixe finit par « : »). */
  keys(prefix: string): Promise<string[]>;
  /** Tables de hachage (utilisées pour les abonnements push). */
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mémoire
// ---------------------------------------------------------------------------

export class MemoryKV implements KV {
  private values = new Map<string, string>();
  private hashes = new Map<string, Map<string, string>>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async cas(key: string, versionKey: string, expected: number, next: number, value: string): Promise<boolean> {
    const current = Number(this.values.get(versionKey) ?? 0);
    if (current !== expected) return false;
    this.values.set(key, value);
    this.values.set(versionKey, String(next));
    return true;
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((k) => k.startsWith(prefix));
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    this.hashes.get(key)!.set(field, value);
  }

  async hdel(key: string, field: string): Promise<void> {
    this.hashes.get(key)?.delete(field);
  }
}

// ---------------------------------------------------------------------------
// Fichiers JSON (développement local)
// ---------------------------------------------------------------------------

/** Petit délai utilitaire. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Écriture atomique : on écrit dans un fichier temporaire puis on le renomme.
 * Sous Windows, le rename peut échouer brièvement (antivirus, indexation) :
 * on réessaie quelques fois.
 */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      lastError = err;
      await sleep(20 * (attempt + 1));
    }
  }
  await fsp.unlink(tmp).catch(() => {});
  throw lastError;
}

/**
 * Stockage sur disque. Correspondance clé → fichier :
 *   vestiaire:current        → <dir>/current.json
 *   vestiaire:version        → <dir>/version.json
 *   vestiaire:archive:<id>   → <dir>/archive/<id>.json
 *   vestiaire:push           → <dir>/push.json (table de hachage)
 */
export class FileKV implements KV {
  private dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
  }

  private fileFor(key: string): string {
    const parts = key.replace(/^vestiaire:/, '').split(':').filter(Boolean);
    if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
      throw new Error(`Clé invalide : ${key}`);
    }
    return path.join(this.dir, ...parts) + '.json';
  }

  /** Sérialise les opérations d'écriture (une seule à la fois dans ce processus). */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async readFile(file: string): Promise<string | null> {
    try {
      return await fsp.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    return this.readFile(this.fileFor(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.locked(() => writeAtomic(this.fileFor(key), value));
  }

  async cas(key: string, versionKey: string, expected: number, next: number, value: string): Promise<boolean> {
    return this.locked(async () => {
      const current = Number((await this.readFile(this.fileFor(versionKey))) ?? 0) || 0;
      if (current !== expected) return false;
      await writeAtomic(this.fileFor(key), value);
      await writeAtomic(this.fileFor(versionKey), String(next));
      return true;
    });
  }

  async keys(prefix: string): Promise<string[]> {
    // Seuls les préfixes de « dossier » (terminés par « : ») sont supportés.
    const dir = path.dirname(this.fileFor(prefix + 'x'));
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map((f) => prefix + f.slice(0, -'.json'.length));
  }

  private async readHash(key: string): Promise<Record<string, string>> {
    const raw = await this.readFile(this.fileFor(key));
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.readHash(key);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.locked(async () => {
      const hash = await this.readHash(key);
      hash[field] = value;
      await writeAtomic(this.fileFor(key), JSON.stringify(hash, null, 2));
    });
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.locked(async () => {
      const hash = await this.readHash(key);
      if (!(field in hash)) return;
      delete hash[field];
      await writeAtomic(this.fileFor(key), JSON.stringify(hash, null, 2));
    });
  }
}
