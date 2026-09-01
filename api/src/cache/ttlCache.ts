/**
 * A minimal, generic, module-scope-friendly TTL cache — the same
 * per-container-lifetime shape `db/pool.ts`'s memoized pool and
 * `ai/geminiClient.ts`'s memoized key already use, extended to hold many
 * keyed entries instead of one. In-memory only, per Lambda execution
 * environment: nothing here reaches DynamoDB or any cross-container store
 * (E2E_MVP_PLAN.md §14.2.8, D2 — a DDB round trip to avoid an Aurora round
 * trip was rejected explicitly rather than left unexamined).
 *
 * No cleanup timer sweeps expired entries — they are lazily evicted on
 * their own next `get`. A container's whole cache is bounded by how many
 * distinct keys it actually sees within one warm lifetime, which for this
 * app's two current consumers (`(userId, householdId)` pairs,
 * `cognitoSub`s) is small.
 */
export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    /** Injectable for tests — defaults to the real wall clock. */
    private readonly now: () => number = Date.now,
  ) {}

  /** `undefined` for a missing key and for an expired one — callers never need to tell the two apart. */
  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Best-effort local invalidation (§14.2.8, D2 part 3) — this container's own entry only, no cross-container reach. */
  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
