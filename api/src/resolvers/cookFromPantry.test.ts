import { randomUUID } from 'node:crypto';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiCookSuggestions } from '../ai/schemas/cookSuggestions.js';
import type { CookSummary } from '../ai/cookMetric.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { AiTimeoutError, AiUnavailableError, ForbiddenError, RateLimitedError, UnauthorizedError, ValidationError } from '../errors.js';
import { checkAndIncrementDailyAction } from '../rateLimit/dailyActionLimiter.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { insertPantryItem } from '../repositories/pantryRepository.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import {
  CACHE_WRITE_TIMEOUT_MS,
  COOK_DEADLINE_MS,
  createCookFromPantryHandler,
  HANDLER_BUDGET_MS,
  MAX_COOK_REQUESTS_PER_DAY,
  MIN_MODEL_BUDGET_MS,
} from './cookFromPantry.js';
import type { CookFromPantryResolverDeps } from './cookFromPantry.js';

type Args = { householdId: unknown; vibe: unknown };

const buildEvent = (householdId: unknown, vibe: unknown, cognitoSub: string | null): AppSyncResolverEvent<Args> => ({
  arguments: { householdId, vibe },
  identity:
    cognitoSub === null
      ? null
      : ({
          sub: cognitoSub,
          issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
          username: cognitoSub,
          claims: { email: `${cognitoSub}@example.test` },
          sourceIp: ['127.0.0.1'],
          defaultAuthStrategy: 'ALLOW',
          groups: null,
        } as unknown as AppSyncResolverEvent<Args>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: { selectionSetList: ['outcome'], selectionSetGraphQL: '{ outcome }', parentTypeName: 'Mutation', fieldName: 'cookFromPantry', variables: {} },
  prev: null,
  stash: {},
});

const raw = (title: string, ingredients: string[], over: Record<string, unknown> = {}): GeminiCookSuggestions['suggestions'][number] =>
  ({
    title,
    description: null,
    servings: 4,
    prepMin: 5,
    cookMin: 20,
    cuisineTier1: 'north_indian',
    cuisineTier2: null,
    dietaryTags: ['veg'],
    role: 'sabzi_dal',
    ingredients: ingredients.map((name) => ({ name, quantity: '1', unit: null, notes: null })),
    steps: ['Cook it.', 'Serve it.'],
    ...over,
  }) as GeminiCookSuggestions['suggestions'][number];

const PANTRY = ['Toor Dal', 'Potato', 'Tomato', 'Jeera', 'Basmati Rice', 'Onion', 'Mustard Oil'];

describe('cookFromPantry resolver', () => {
  let db: TestDatabase;
  let pool: Pool;
  let ddb: TestDynamoDb;
  let owner: UserRow;
  let householdId: string;
  let sub: string;

  beforeAll(async () => {
    [db, ddb] = await Promise.all([startTestDatabase(), startTestDynamoDb()]);
    pool = new Pool({ connectionString: db.appUri });
  }, 180_000);
  afterAll(async () => {
    await pool.end();
    await Promise.all([db.stop(), ddb.stop()]);
  });

  const addPantry = async (name: string, category: string | null = 'dal', quantity = 1): Promise<void> => {
    await withUserTransaction(
      owner.id,
      (client) => insertPantryItem(client, { householdId, name, quantity, unit: 'kg', category, isStaple: false, expiryDate: null, lowThreshold: null, addedBy: owner.id }),
      pool,
    );
  };
  const setSettings = async (fields: string): Promise<void> => {
    await db.adminClient.query(`UPDATE household_settings SET ${fields} WHERE household_id = $1`, [householdId]);
  };
  const quotaUsed = async (): Promise<number> => {
    const day = new Date().toISOString().slice(0, 10);
    const { Item } = await ddb.client.send(new GetCommand({ TableName: ddb.tableName, Key: { PK: `RATELIMIT#cookFromPantry#${sub}`, SK: day } }));
    return (Item?.['attempts'] as number | undefined) ?? 0;
  };
  const cacheRows = async (): Promise<number> => {
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const out = await ddb.client.send(new ScanCommand({ TableName: ddb.tableName }));
    return (out.Items ?? []).filter((i) => String(i['PK']).startsWith(`aiCache#cookFromPantry#${householdId}#`)).length;
  };

  const createUser = async (cognitoSub: string): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, { cognitoSub, email: `${cognitoSub}@example.test`, displayName: null, avatarUrl: null });
    } finally {
      client.release();
    }
  };

  beforeEach(async () => {
    sub = `sub-${randomUUID()}`;
    owner = await createUser(sub);
    householdId = await withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, { name: 'H', inviteCode: `INV${randomUUID().slice(0, 3).toUpperCase()}`, primaryUserId: owner.id });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        return household.id;
      },
      pool,
    );
    for (const name of PANTRY) {
      await addPantry(name, name === 'Mustard Oil' ? 'oil' : name === 'Jeera' ? 'spice' : 'dal');
    }
  });
  afterEach(async () => {
    await truncateAll(db.adminClient);
    vi.restoreAllMocks();
  });

  const good = (): GeminiCookSuggestions => ({
    suggestions: [
      raw('Aloo Jeera', ['potato', 'jeera', 'mustard oil', 'salt']),
      raw('Dal Tadka', ['toor dal', 'tomato', 'onion', 'jeera', 'coriander']),
      raw('Jeera Rice', ['basmati rice', 'jeera', 'cooking oil']),
    ],
  });

  const makeDeps = (over: Partial<CookFromPantryResolverDeps> = {}): { deps: CookFromPantryResolverDeps; calls: string[]; metrics: CookSummary[] } => {
    const calls: string[] = [];
    const metrics: CookSummary[] = [];
    const deps: CookFromPantryResolverDeps = {
      getPool: async () => pool,
      getDdbClient: () => ddb.client,
      getCacheTableName: () => ddb.tableName,
      callModel: async (prompt) => {
        calls.push(prompt);
        return good();
      },
      emitMetric: (summary) => metrics.push(summary),
      ...over,
    };
    return { deps, calls, metrics };
  };
  const run = (deps: CookFromPantryResolverDeps, vibe: unknown = 'quick', hh: unknown = householdId, who: string | null = sub) =>
    createCookFromPantryHandler(deps)(buildEvent(hh, vibe, who));

  describe('rejections cost nothing (D7)', () => {
    it('rejects a null identity', async () => {
      await expect(run(makeDeps().deps, 'quick', householdId, null)).rejects.toThrow(UnauthorizedError);
    });

    it.each([['not-a-uuid', 'quick'], [randomUUID(), 'spicy'], [randomUUID(), 'constructor'], [null, 'quick']])('rejects invalid args (%j, %j) before any model call or quota', async (hh, vibe) => {
      const { deps, calls } = makeDeps();
      await expect(run(deps, vibe, hh)).rejects.toThrow(ValidationError);
      expect(calls).toHaveLength(0);
      expect(await quotaUsed()).toBe(0);
    });

    it('refuses a non-member before touching the cache, the model or the quota', async () => {
      const { deps, calls } = makeDeps();
      await expect(run(deps, 'quick', householdId, `stranger-${randomUUID()}`)).rejects.toThrow(ForbiddenError);
      expect(calls).toHaveLength(0);
      expect(await cacheRows()).toBe(0);
      expect(await quotaUsed()).toBe(0);
    });

    it('gives a nonexistent household the identical refusal as a real household the caller is not in', async () => {
      const a = await run(makeDeps().deps, 'quick', randomUUID()).catch((e: unknown) => e as Error);
      const b = await run(makeDeps().deps, 'quick', householdId, `stranger-${randomUUID()}`).catch((e: unknown) => e as Error);
      expect((a as Error).message).toBe((b as Error).message);
    });

    it('answers a pantry too small to cook from with an outcome, not an error, before the cache, model or quota', async () => {
      await db.adminClient.query('DELETE FROM pantry_items WHERE household_id = $1', [householdId]);
      await addPantry('Toor Dal');
      await addPantry('Jeera', 'spice');
      const { deps, calls, metrics } = makeDeps();
      await expect(run(deps)).resolves.toEqual({ outcome: 'pantry_too_small', vibe: 'quick', suggestions: [] });
      expect(calls).toHaveLength(0);
      expect(await quotaUsed()).toBe(0);
      expect(await cacheRows()).toBe(0);
      expect(metrics[0]?.outcome).toBe('pantry_too_small');
    });
  });

  describe('a successful call', () => {
    it('returns grounded suggestions, with the pantry row\'s own names as Have and the model\'s wording as Missing', async () => {
      const { deps } = makeDeps();
      const result = await run(deps);
      expect(result.outcome).toBe('suggestions');
      expect(result.suggestions).toHaveLength(3);
      const aloo = result.suggestions.find((s) => s.draft.title === 'Aloo Jeera');
      expect(aloo?.have.sort()).toEqual(['Jeera', 'Mustard Oil', 'Potato']);
      const dal = result.suggestions.find((s) => s.draft.title === 'Dal Tadka');
      expect(dal?.missing).toEqual(['coriander']);
      expect(dal?.have).toContain('Toor Dal');
    });

    it('returns exactly one match per draft ingredient, in order, using the SDL\'s lowercase enum values', async () => {
      const result = await run(makeDeps().deps);
      for (const suggestion of result.suggestions) {
        expect(suggestion.ingredientMatches).toHaveLength(suggestion.draft.ingredients.length);
        for (const match of suggestion.ingredientMatches) {
          expect(['in_pantry', 'missing', 'assumed']).toContain(match.status);
          expect(match.status === 'in_pantry').toBe(match.pantryItemName !== null);
        }
      }
      const aloo = result.suggestions.find((s) => s.draft.title === 'Aloo Jeera');
      expect(aloo?.ingredientMatches.map((m) => m.status)).toEqual(['in_pantry', 'in_pantry', 'in_pantry', 'assumed']);
    });

    it('passes the draft through unsaved: a role proposal, no source URL', async () => {
      const result = await run(makeDeps().deps);
      const draft = result.suggestions[0]?.draft;
      expect(draft?.role).toBe('sabzi_dal');
      expect(draft?.sourceUrl).toBeNull();
    });

    it('spends exactly one unit of quota and writes exactly one cache row', async () => {
      await run(makeDeps().deps);
      expect(await quotaUsed()).toBe(1);
      expect(await cacheRows()).toBe(1);
    });

    it('sends the model the pantry names and the household\'s rules, with the settled sampling settings and a bounded deadline', async () => {
      await setSettings(`dietary_tags = '["veg"]'::jsonb, skip_ingredients = '["garlic"]'::jsonb, allergens = '["peanuts"]'::jsonb`);
      const seen: { prompt: string; deadlineMs: number; temperature: number; maxOutputTokens: number }[] = [];
      const { deps } = makeDeps({
        callModel: async (prompt, options) => {
          seen.push({ prompt, ...options });
          return good();
        },
      });
      await run(deps, 'comfort');
      expect(seen).toHaveLength(1);
      expect(seen[0]?.prompt).toContain('toor dal');
      expect(seen[0]?.prompt).toContain('garlic');
      expect(seen[0]?.prompt).toContain('peanuts');
      expect(seen[0]?.temperature).toBe(0.6);
      expect(seen[0]?.maxOutputTokens).toBe(3500);
      expect(seen[0]?.deadlineMs).toBeLessThanOrEqual(COOK_DEADLINE_MS);
      expect(seen[0]?.deadlineMs).toBeGreaterThanOrEqual(MIN_MODEL_BUDGET_MS);
    });

    it('holds no database connection while the model is called (there is no RDS Proxy)', async () => {
      let busy = -1;
      const { deps } = makeDeps({
        callModel: async () => {
          busy = pool.totalCount - pool.idleCount;
          return good();
        },
      });
      await run(deps);
      expect(busy).toBe(0);
    });

    it('does not count or offer an item that has run out', async () => {
      await addPantry('Saffron', 'spice', 0);
      const { deps, calls } = makeDeps();
      await run(deps);
      expect(calls[0]).not.toContain('saffron');
    });
  });

  describe('the cache (D5): a hit never spends quota, and grounding is recomputed on every read', () => {
    it('answers an identical second request from the cache without the model or the quota', async () => {
      const { deps, calls, metrics } = makeDeps();
      await run(deps);
      await run(deps);
      expect(calls).toHaveLength(1);
      expect(await quotaUsed()).toBe(1);
      expect(metrics.map((m) => m.cacheHit)).toEqual([false, true]);
    });

    it('serves a second household member the first member\'s suggestions for free', async () => {
      const other = `sub-${randomUUID()}`;
      const user = await createUser(other);
      await db.adminClient.query(`INSERT INTO household_memberships (household_id, user_id, role) VALUES ($1, $2, 'member')`, [householdId, user.id]);
      const { deps, calls } = makeDeps();
      await run(deps, 'quick', householdId, sub);
      await run(deps, 'quick', householdId, other);
      expect(calls).toHaveLength(1);
    });

    it('re-grounds a cached answer against the CURRENT pantry: a change the prompt never sees still changes Have and Missing', async () => {
      // The prompt carries names only, so recategorising an item leaves the cache key alone, but a generic
      // "cooking oil" is grounded through the oil CATEGORY, so its match must follow the change on a cache hit.
      await db.adminClient.query(`DELETE FROM pantry_items WHERE household_id = $1 AND name = 'Mustard Oil'`, [householdId]);
      await addPantry('Sunlite', 'oil');
      let modelCalls = 0;
      const { deps } = makeDeps({
        callModel: async () => {
          modelCalls += 1;
          return { suggestions: [raw('Aloo Jeera', ['potato', 'jeera', 'cooking oil']), raw('Dal', ['toor dal', 'tomato']), raw('Rice', ['basmati rice', 'jeera'])] };
        },
      });
      const first = await run(deps);
      expect(first.suggestions.find((s) => s.draft.title === 'Aloo Jeera')?.have).toContain('Sunlite');
      await db.adminClient.query(`UPDATE pantry_items SET category = 'other' WHERE household_id = $1 AND name = 'Sunlite'`, [householdId]);
      const second = await run(deps);
      expect(modelCalls).toBe(1);
      const aloo = second.suggestions.find((s) => s.draft.title === 'Aloo Jeera');
      expect(aloo?.have).not.toContain('Sunlite');
      expect(aloo?.missing).toContain('cooking oil');
    });

    it('misses when the pantry changes (a new item), the vibe changes, or the skip list changes', async () => {
      const { deps, calls } = makeDeps();
      await run(deps, 'quick');
      await addPantry('Ghee', 'dairy');
      await run(deps, 'quick');
      await run(deps, 'comfort');
      await setSettings(`skip_ingredients = '["coriander"]'::jsonb`);
      await run(deps, 'comfort');
      expect(calls).toHaveLength(4);
    });

    it('treats a corrupted cache row as a miss and calls the model', async () => {
      const { deps, calls } = makeDeps();
      await run(deps);
      const { ScanCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
      const rows = (await ddb.client.send(new ScanCommand({ TableName: ddb.tableName }))).Items ?? [];
      const row = rows.find((i) => String(i['PK']).startsWith(`aiCache#cookFromPantry#${householdId}#`));
      await ddb.client.send(new PutCommand({ TableName: ddb.tableName, Item: { ...row, payload: '{broken' } }));
      await run(deps);
      expect(calls).toHaveLength(2);
    });
  });

  describe('quota and budget (D7, D10)', () => {
    it(`refuses the ${String(MAX_COOK_REQUESTS_PER_DAY + 1)}th miss of the day with RATE_LIMITED, before the model`, async () => {
      for (let i = 0; i < MAX_COOK_REQUESTS_PER_DAY; i += 1) {
        await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'cookFromPantry', sub, MAX_COOK_REQUESTS_PER_DAY, 'x');
      }
      const { deps, calls } = makeDeps();
      await expect(run(deps)).rejects.toThrow(RateLimitedError);
      expect(calls).toHaveLength(0);
    });

    it('still answers a cache hit when the daily limit is used up', async () => {
      const { deps } = makeDeps();
      await run(deps);
      for (let i = 0; i < MAX_COOK_REQUESTS_PER_DAY; i += 1) {
        await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'cookFromPantry', sub, MAX_COOK_REQUESTS_PER_DAY, 'x').catch(() => undefined);
      }
      await expect(run(deps)).resolves.toMatchObject({ outcome: 'suggestions' });
    });

    it('uses the same limit copy the schema promises', async () => {
      for (let i = 0; i < MAX_COOK_REQUESTS_PER_DAY; i += 1) {
        await checkAndIncrementDailyAction(ddb.client, ddb.tableName, 'cookFromPantry', sub, MAX_COOK_REQUESTS_PER_DAY, 'x');
      }
      await expect(run(makeDeps().deps)).rejects.toThrow(`You've asked for ideas ${String(MAX_COOK_REQUESTS_PER_DAY)} times today — that's the daily limit. Your saved recipes are all still here.`);
    });

    it('gives the model the remaining handler budget less the cache-write reserve, capped at the cook deadline', async () => {
      const seen: number[] = [];
      const record = async (_prompt: string, options: { deadlineMs: number }): Promise<GeminiCookSuggestions> => {
        seen.push(options.deadlineMs);
        return good();
      };
      let reads = 0;
      // Handler start reads 0; every later reading is 12s in, leaving 14s, less the 1s reserve.
      await run(makeDeps({ callModel: record, nowMs: () => (reads++ === 0 ? 0 : 12_000) }).deps, 'quick');
      expect(seen[0]).toBe(HANDLER_BUDGET_MS - 12_000 - 1_000);
      // A fast start leaves more than the cook deadline, so the deadline is the cap.
      await run(makeDeps({ callModel: record, nowMs: () => 0 }).deps, 'weekend');
      expect(seen[1]).toBe(COOK_DEADLINE_MS);
    });

    it('throws AI_TIMEOUT before spending any quota when too little of the budget is left', async () => {
      let reads = 0;
      const { deps, calls } = makeDeps({ nowMs: () => (reads++ === 0 ? 0 : HANDLER_BUDGET_MS - MIN_MODEL_BUDGET_MS + 500) });
      await expect(run(deps)).rejects.toThrow(AiTimeoutError);
      expect(calls).toHaveLength(0);
      expect(await quotaUsed()).toBe(0);
    });

    it('spends one unit and caches nothing when the model fails after the quota step', async () => {
      const { deps } = makeDeps({
        callModel: async () => {
          throw new AiUnavailableError();
        },
      });
      await expect(run(deps)).rejects.toThrow(AiUnavailableError);
      expect(await quotaUsed()).toBe(1);
      expect(await cacheRows()).toBe(0);
    });
  });

  describe('the household\'s rules are enforced on the server (D4)', () => {
    it('drops a suggestion that uses a skip-listed ingredient, even one the model was told to avoid', async () => {
      await setSettings(`skip_ingredients = '["mustard"]'::jsonb`);
      const result = await run(makeDeps().deps);
      expect(result.suggestions.map((s) => s.draft.title)).not.toContain('Aloo Jeera');
      expect(result.suggestions).toHaveLength(2);
    });

    it('drops a non-vegetarian suggestion for a vegetarian household even when the model tagged it veg', async () => {
      await setSettings(`dietary_tags = '["veg"]'::jsonb`);
      const { deps } = makeDeps({
        callModel: async () => ({ suggestions: [...good().suggestions, raw('Chicken Rice', ['basmati rice', 'jeera', 'chicken'], { dietaryTags: ['veg'] })] }),
      });
      const result = await run(deps);
      expect(result.suggestions.map((s) => s.draft.title)).not.toContain('Chicken Rice');
    });

    it('adds an allergen warning to the draft instead of hiding it', async () => {
      await setSettings(`allergens = '["tomato"]'::jsonb`);
      const result = await run(makeDeps().deps);
      const dal = result.suggestions.find((s) => s.draft.title === 'Dal Tadka');
      expect(dal?.draft.warnings.some((w) => w.includes('tomato'))).toBe(true);
    });

    it('drops a suggestion that is not grounded in the pantry (too few matches or too much missing)', async () => {
      const { deps } = makeDeps({
        callModel: async () => ({
          suggestions: [
            raw('Fantasy', ['saffron', 'truffle', 'caviar', 'edible gold', 'wagyu']),
            raw('Aloo Jeera', ['potato', 'jeera']),
            raw('Dal', ['toor dal', 'tomato']),
          ],
        }),
      });
      const result = await run(deps);
      expect(result.suggestions.map((s) => s.draft.title)).toEqual(['Aloo Jeera', 'Dal']);
    });

    it('keeps the best 3 by have-ratio when the model offers more', async () => {
      const { deps } = makeDeps({
        callModel: async () => ({
          suggestions: [
            raw('Low', ['potato', 'jeera', 'x1', 'x2', 'x3', 'x4']),
            raw('High A', ['potato', 'jeera']),
            raw('High B', ['toor dal', 'tomato']),
            raw('High C', ['basmati rice', 'jeera']),
            raw('Mid', ['potato', 'jeera', 'x1']),
          ],
        }),
      });
      const result = await run(deps);
      expect(result.suggestions.map((s) => s.draft.title)).toEqual(['High A', 'High B', 'High C']);
    });

    it('answers no_grounded_suggestions, caches nothing, and still counts the quota when nothing survives', async () => {
      const { deps, metrics } = makeDeps({ callModel: async () => ({ suggestions: [raw('Fantasy', ['saffron', 'truffle', 'caviar'])] }) });
      await expect(run(deps)).resolves.toEqual({ outcome: 'no_grounded_suggestions', vibe: 'quick', suggestions: [] });
      expect(await cacheRows()).toBe(0);
      expect(await quotaUsed()).toBe(1);
      expect(metrics[0]?.droppedUngrounded).toBe(1);
    });

    it('answers no_grounded_suggestions when the model returns nothing at all', async () => {
      const { deps } = makeDeps({ callModel: async () => ({ suggestions: [] }) });
      await expect(run(deps)).resolves.toMatchObject({ outcome: 'no_grounded_suggestions' });
    });
  });

  describe('found in review', () => {
    it('grounds on the model\'s own ingredient names, not the draft name that folds a vague quantity in ("onion (a fistful)")', async () => {
      const { deps } = makeDeps({
        callModel: async () => ({
          suggestions: [
            { ...raw('Aloo Onion', ['potato']), ingredients: [{ name: 'potato', quantity: 'a fistful', unit: null, notes: null }, { name: 'onion', quantity: 'to taste', unit: null, notes: null }] },
            raw('Dal', ['toor dal', 'tomato']),
            raw('Rice', ['basmati rice', 'jeera']),
          ],
        }),
      });
      const aloo = (await run(deps)).suggestions.find((s) => s.draft.title === 'Aloo Onion');
      expect(aloo?.have.sort()).toEqual(['Onion', 'Potato']);
      expect(aloo?.missing).toEqual([]);
    });

    it('gives each suggestion a stable id that survives a cache hit, and echoes the vibe and each ingredient\'s wording', async () => {
      const { deps } = makeDeps();
      const first = await run(deps, 'comfort');
      const second = await run(deps, 'comfort');
      expect(first.vibe).toBe('comfort');
      expect(first.suggestions.map((s) => s.id)).toEqual(second.suggestions.map((s) => s.id));
      expect(new Set(first.suggestions.map((s) => s.id)).size).toBe(first.suggestions.length);
      const aloo = first.suggestions.find((s) => s.draft.title === 'Aloo Jeera');
      expect(aloo?.ingredientMatches.map((m) => m.ingredient)).toEqual(['potato', 'jeera', 'mustard oil', 'salt']);
    });

    it('echoes a null vibe for "any vibe"', async () => {
      expect((await run(makeDeps().deps, null)).vibe).toBeNull();
    });

    it('lowercases the household id, so an upper-case id hits the same cache row as the lower-case one', async () => {
      const { deps, calls } = makeDeps();
      await run(deps, 'quick', householdId);
      await run(deps, 'quick', householdId.toUpperCase());
      expect(calls).toHaveLength(1);
    });

    it('still works for a household with no settings row (no rules)', async () => {
      await db.adminClient.query('DELETE FROM household_settings WHERE household_id = $1', [householdId]);
      await expect(run(makeDeps().deps)).resolves.toMatchObject({ outcome: 'suggestions' });
    });

    it('treats a failing cache read as a miss rather than failing the request, and logs no content', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const flaky = { send: (command: unknown) => (command instanceof GetCommand ? Promise.reject(new Error('throttled')) : ddb.client.send(command as never)) } as unknown as DynamoDBDocumentClient;
      const { deps, calls } = makeDeps({ getDdbClient: () => flaky });
      await expect(run(deps)).resolves.toMatchObject({ outcome: 'suggestions' });
      expect(calls).toHaveLength(1);
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/toor dal|potato/i);
    });

    it('still returns the answer when the cache write fails after the quota was spent', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      const flaky = { send: (command: unknown) => (command instanceof PutCommand ? Promise.reject(new Error('down')) : ddb.client.send(command as never)) } as unknown as DynamoDBDocumentClient;
      await expect(run(makeDeps({ getDdbClient: () => flaky }).deps)).resolves.toMatchObject({ outcome: 'suggestions' });
      expect(await quotaUsed()).toBe(1);
    });

    it('abandons a cache write that hangs instead of holding the response past the AppSync ceiling', async () => {
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      const hanging = { send: (command: unknown) => (command instanceof PutCommand ? new Promise(() => undefined) : ddb.client.send(command as never)) } as unknown as DynamoDBDocumentClient;
      const startedAt = Date.now();
      await expect(run(makeDeps({ getDdbClient: () => hanging }).deps)).resolves.toMatchObject({ outcome: 'suggestions' });
      expect(Date.now() - startedAt).toBeLessThan(CACHE_WRITE_TIMEOUT_MS + 2_500);
    }, 15_000);

    it('measures the model deadline AFTER the quota call, so a slow quota round trip cannot push the total past the budget', async () => {
      const seen: number[] = [];
      let clock = 0;
      const slowQuota = { send: (command: unknown) => { if ((command as { constructor: { name: string } }).constructor.name === 'UpdateCommand') { clock += 8_000; } return ddb.client.send(command as never); } } as unknown as DynamoDBDocumentClient;
      const { deps } = makeDeps({
        getDdbClient: () => slowQuota,
        nowMs: () => clock,
        callModel: async (_p, options) => {
          seen.push(options.deadlineMs);
          return good();
        },
      });
      await run(deps);
      expect(seen[0]).toBe(HANDLER_BUDGET_MS - 8_000 - 1_000);
    });

    it('starts the model call at exactly the minimum budget, and refuses just below it', async () => {
      const at = (elapsed: number) => makeDeps({ nowMs: (() => { let n = 0; return () => (n++ === 0 ? 0 : elapsed); })() });
      const ok = at(HANDLER_BUDGET_MS - 1_000 - MIN_MODEL_BUDGET_MS);
      await expect(run(ok.deps)).resolves.toMatchObject({ outcome: 'suggestions' });
      const refused = at(HANDLER_BUDGET_MS - 1_000 - MIN_MODEL_BUDGET_MS + 1);
      await expect(run(refused.deps, 'weekend')).rejects.toThrow(AiTimeoutError);
    });

    it('emits a Failed metric when a call fails (rate limited, timed out, model error), so failure rate and latency are measurable', async () => {
      const { deps, metrics } = makeDeps({ callModel: async () => { throw new AiUnavailableError(); } });
      await expect(run(deps)).rejects.toThrow(AiUnavailableError);
      expect(metrics.map((m) => m.outcome)).toEqual(['failed']);
    });
  });

  describe('measurement and privacy (D13, D11)', () => {
    it('emits one summary per call with counts only', async () => {
      const { deps, metrics } = makeDeps();
      await run(deps);
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({ cacheHit: false, outcome: 'suggestions', suggestionsReturned: 3 });
      expect(metrics[0]?.meanHaveRatio).toBeGreaterThan(0.5);
    });

    it('never writes pantry, settings or suggestion content to any log', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
      await setSettings(`skip_ingredients = '["garlic"]'::jsonb, allergens = '["peanuts"]'::jsonb`);
      const { deps } = makeDeps();
      delete (deps as { emitMetric?: unknown }).emitMetric;
      await run(deps).catch(() => undefined);
      const written = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n').toLowerCase();
      for (const secret of ['toor dal', 'potato', 'jeera', 'garlic', 'peanuts', 'aloo jeera', 'dal tadka']) {
        expect(written).not.toContain(secret);
      }
    });

    it('a metering failure never fails the request', async () => {
      const { deps } = makeDeps({
        emitMetric: () => {
          throw new Error('boom');
        },
      });
      await expect(run(deps)).resolves.toMatchObject({ outcome: 'suggestions' });
    });
  });
});
