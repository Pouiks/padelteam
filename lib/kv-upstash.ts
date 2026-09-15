/**
 * Implémentation KV sur Upstash Redis (API REST, compatible serverless).
 * Sur Vercel, ajouter « Upstash for Redis » dans l'onglet Storage du projet :
 * les variables d'environnement sont injectées automatiquement.
 */
import { Redis } from '@upstash/redis';
import type { KV } from './kv.ts';

/**
 * Script Lua exécuté atomiquement côté Redis : compare la version puis écrit.
 * KEYS[1] = clé de la valeur, KEYS[2] = clé de version,
 * ARGV[1] = version attendue, ARGV[2] = nouvelle version, ARGV[3] = valeur.
 */
const CAS_SCRIPT = `
local v = redis.call('GET', KEYS[2])
if v == false then v = '0' end
if v ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[3])
redis.call('SET', KEYS[2], ARGV[2])
return 1
`;

export class UpstashKV implements KV {
  private redis: Redis;

  constructor(url: string, token: string) {
    // On gère la sérialisation JSON nous-mêmes : le client ne doit pas toucher aux valeurs.
    this.redis = new Redis({ url, token, automaticDeserialization: false });
  }

  async get(key: string): Promise<string | null> {
    const value = await this.redis.get<string>(key);
    return value === undefined || value === null ? null : String(value);
  }

  async set(key: string, value: string): Promise<void> {
    await this.redis.set(key, value);
  }

  async cas(key: string, versionKey: string, expected: number, next: number, value: string): Promise<boolean> {
    const result = await this.redis.eval(CAS_SCRIPT, [key, versionKey], [String(expected), String(next), value]);
    return Number(result) === 1;
  }

  async keys(prefix: string): Promise<string[]> {
    return this.redis.keys(`${prefix}*`);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = await this.redis.hgetall<Record<string, string>>(key);
    return hash ?? {};
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.redis.hset(key, { [field]: value });
  }

  async hdel(key: string, field: string): Promise<void> {
    await this.redis.hdel(key, field);
  }
}

/** Construit le client depuis l'environnement, ou null si rien n'est configuré. */
export function upstashFromEnv(): UpstashKV | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new UpstashKV(url, token);
}
