/**
 * Le « store » : l'état de l'application (cycle, joueurs, matchs) est un unique
 * document JSON, accompagné d'un numéro de version. Chaque modification passe
 * par `mutate`, qui relit l'état, applique la fonction, puis écrit avec une
 * écriture conditionnelle (compare-and-set). Si deux fonctions serverless
 * écrivent en même temps, la seconde relit et réessaie : aucune perte de données.
 *
 * Le cycle de 48 h est vérifié « paresseusement » à chaque lecture/écriture :
 * pas besoin de processus qui tourne en permanence (impossible en serverless).
 */
import type { KV } from './kv.ts';
import type {
  ArchivedCycle,
  ArchiveSummary,
  MatchEvent,
  PushSubscriptionRecord,
  State,
  VersionedState,
} from './types.ts';
import { cycleEndsAt, isCycleExpired, newCycle } from './cycle.ts';
import { DEFAULT_COURTS } from './constants.ts';

const KEYS = {
  current: 'vestiaire:current',
  version: 'vestiaire:version',
  archive: 'vestiaire:archive:',
  push: 'vestiaire:push',
} as const;

const MAX_ATTEMPTS = 6;

export class ConflictError extends Error {
  name = 'ConflictError';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function emptyState(now: number = Date.now()): State {
  return { cycle: newCycle(now), players: {}, events: {} };
}

/**
 * Met un match lu sur disque au format courant. Un match lancé avec l'ancien
 * tableau à élimination simple (`rounds`, sans `matches`) ne peut pas être
 * converti : il revient aux inscriptions, inscrits conservés, prêt à être relancé.
 */
function normalizeEvent(raw: MatchEvent & { rounds?: unknown }): MatchEvent {
  const { rounds: _legacy, ...event } = raw;
  if (!Number.isInteger(event.courts) || event.courts < 1) event.courts = DEFAULT_COURTS;
  if (!Array.isArray(event.matches)) {
    event.matches = [];
    if (event.status !== 'open') {
      event.status = 'open';
      event.teams = [];
      event.subs = [];
      event.winner = null;
    }
  }
  return event;
}

/** Remet un état lu sur disque dans une forme sûre (champs manquants, etc.). */
function normalize(raw: unknown, now: number): State {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<State>;
  const cycle =
    obj.cycle && typeof obj.cycle.startedAt === 'string' && typeof obj.cycle.id === 'string'
      ? obj.cycle
      : newCycle(now);
  const events: State['events'] = {};
  if (obj.events && typeof obj.events === 'object') {
    for (const [id, event] of Object.entries(obj.events)) {
      if (event && typeof event === 'object') events[id] = normalizeEvent(event);
    }
  }
  return {
    cycle,
    players: obj.players && typeof obj.players === 'object' ? obj.players : {},
    events,
  };
}

export class Store {
  private kv: KV;
  private now: () => number;

  /**
   * @param kv  stockage sous-jacent
   * @param now horloge injectable (tests)
   */
  constructor(kv: KV, now: () => number = Date.now) {
    this.kv = kv;
    this.now = now;
  }

  /** Lecture brute. `fresh` signale qu'aucun état n'a encore été écrit. */
  private async readRaw(): Promise<{ state: State; version: number; fresh: boolean }> {
    const [raw, v] = await Promise.all([this.kv.get(KEYS.current), this.kv.get(KEYS.version)]);
    const version = Number(v ?? 0) || 0;
    const now = this.now();
    if (!raw) return { state: emptyState(now), version, fresh: true };
    try {
      return { state: normalize(JSON.parse(raw), now), version, fresh: false };
    } catch {
      console.warn('[vestiaire] état illisible, on repart d’un état vide');
      return { state: emptyState(now), version, fresh: true };
    }
  }

  /** Lit l'état courant, en effectuant la rotation de cycle si elle est due. */
  async getState(): Promise<VersionedState> {
    const { state, version, fresh } = await this.readRaw();
    if (fresh || isCycleExpired(state.cycle, this.now())) {
      // Un mutate « vide » suffit : il fixe le début du cycle (premier démarrage)
      // ou archive le cycle écoulé et repart sur un cycle neuf.
      return (await this.mutate(() => undefined)).state;
    }
    return { version, ...state };
  }

  /**
   * Applique une modification à l'état, de façon atomique.
   * `fn` doit être rejouable : en cas de conflit d'écriture, elle est rappelée
   * sur un état fraîchement relu. Si elle lève une erreur, rien n'est écrit.
   */
  async mutate<T>(fn: (state: State) => T | Promise<T>): Promise<{ result: T; state: VersionedState }> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { state, version } = await this.readRaw();
      const now = this.now();
      if (isCycleExpired(state.cycle, now)) await this.archiveCycle(state, now);
      const result = await fn(state);
      const ok = await this.kv.cas(KEYS.current, KEYS.version, version, version + 1, JSON.stringify(state));
      if (ok) return { result, state: { version: version + 1, ...state } };
      await sleep(15 * (attempt + 1) + Math.random() * 30);
    }
    throw new ConflictError('Trop de modifications simultanées, réessaie dans un instant.');
  }

  /** Archive le cycle écoulé (s'il contenait des matchs) et en démarre un nouveau. */
  private async archiveCycle(state: State, now: number): Promise<void> {
    if (Object.keys(state.events).length > 0) {
      const archived: ArchivedCycle = {
        cycle: state.cycle,
        endedAt: new Date(cycleEndsAt(state.cycle)).toISOString(),
        events: state.events,
      };
      // Écrite avant le CAS : en cas de conflit elle sera réécrite à l'identique.
      await this.kv.set(KEYS.archive + state.cycle.id, JSON.stringify(archived));
    }
    state.events = {};
    state.cycle = newCycle(now);
  }

  /** Force la vérification du cycle (utilisé par le cron). Renvoie true si rotation. */
  async rotateIfNeeded(): Promise<boolean> {
    const { state } = await this.readRaw();
    if (!isCycleExpired(state.cycle, this.now())) return false;
    await this.mutate(() => undefined);
    return true;
  }

  /** Cycles archivés, du plus récent au plus ancien. */
  async listArchive(): Promise<ArchiveSummary[]> {
    const keys = await this.kv.keys(KEYS.archive);
    const items = await Promise.all(
      keys.map(async (key): Promise<ArchiveSummary | null> => {
        const raw = await this.kv.get(key);
        if (!raw) return null;
        try {
          const a = JSON.parse(raw) as ArchivedCycle;
          // Les archives gardent leur format d'origine (ancien tableau compris).
          return {
            id: a.cycle.id,
            startedAt: a.cycle.startedAt,
            endedAt: a.endedAt,
            events: Object.entries(a.events ?? {})
              .map(([id, ev]) => ({ id, ...ev }))
              .sort((x, y) => x.createdAt.localeCompare(y.createdAt)),
          };
        } catch {
          return null;
        }
      }),
    );
    return items
      .filter((x): x is ArchiveSummary => x !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  // --- Abonnements push ---------------------------------------------------------

  async getSubscriptions(): Promise<PushSubscriptionRecord[]> {
    const hash = await this.kv.hgetall(KEYS.push);
    const out: PushSubscriptionRecord[] = [];
    for (const raw of Object.values(hash)) {
      try {
        out.push(typeof raw === 'string' ? JSON.parse(raw) : (raw as PushSubscriptionRecord));
      } catch {
        // entrée corrompue : ignorée
      }
    }
    return out;
  }

  async addSubscription(record: PushSubscriptionRecord): Promise<void> {
    await this.kv.hset(KEYS.push, record.subscription.endpoint, JSON.stringify(record));
  }

  async removeSubscription(endpoint: string): Promise<void> {
    await this.kv.hdel(KEYS.push, endpoint);
  }
}
