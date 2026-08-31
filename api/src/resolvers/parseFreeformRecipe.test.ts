import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { createParseFreeformRecipeHandler, MAX_FREEFORM_PARSES_PER_DAY } from './parseFreeformRecipe.js';
import type { ParseFreeformRecipeResolverDeps } from './parseFreeformRecipe.js';
import type { GeminiRecipeDraft } from '../ai/schemas/recipeDraft.js';
import { AiTimeoutError, RateLimitedError, UnauthorizedError, ValidationError } from '../errors.js';

const buildEvent = (text: unknown, cognitoSub: string | null): AppSyncResolverEvent<{ text: unknown }> => ({
  arguments: { text },
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
        } as unknown as AppSyncResolverEvent<{ text: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['title'],
    selectionSetGraphQL: '{ title }',
    parentTypeName: 'Mutation',
    fieldName: 'parseFreeformRecipe',
    variables: {},
  },
  prev: null,
  stash: {},
});

const wellFormedDraft: GeminiRecipeDraft = {
  title: 'Rajma Chawal',
  description: null,
  servings: 4,
  prepMin: 10,
  cookMin: 30,
  cuisineTier1: 'north_indian',
  cuisineTier2: 'Punjabi',
  dietaryTags: ['veg'],
  role: 'sabzi_dal',
  ingredients: [{ name: 'rajma', quantity: '1', unit: 'cup', notes: 'soaked overnight' }],
  steps: ['Soak the rajma.', 'Pressure-cook until soft.'],
};

describe('parseFreeformRecipe resolver', () => {
  let ddb: TestDynamoDb;

  beforeAll(async () => {
    ddb = await startTestDynamoDb();
  }, 120_000);

  afterAll(async () => {
    await ddb.stop();
  });

  const fixedNow = (): (() => Date) => {
    const date = new Date('2026-08-28T12:00:00.000Z');
    return () => date;
  };

  const buildDeps = (overrides: Partial<ParseFreeformRecipeResolverDeps> = {}): ParseFreeformRecipeResolverDeps => ({
    getDdbClient: () => ddb.client,
    getCacheTableName: () => ddb.tableName,
    now: fixedNow(),
    parseWithModel: vi.fn().mockResolvedValue(wellFormedDraft),
    ...overrides,
  });

  it('rejects an unauthenticated caller before touching validation, rate limit, or the model', async () => {
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    await expect(handler(buildEvent('a recipe', null))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.parseWithModel).not.toHaveBeenCalled();
  });

  it('maps a well-formed model response to a RecipeDraft, ingredients in order, raw preserved', async () => {
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    const result = await handler(buildEvent('rajma chawal recipe...', randomUUID()));

    expect(result.title).toBe('Rajma Chawal');
    expect(result.role).toBe('sabzi_dal');
    expect(result.cuisineTier1).toBe('north_indian');
    expect(result.ingredients).toEqual([
      { raw: '1 cup rajma', name: 'rajma', quantity: 1, unit: 'cup', notes: 'soaked overnight' },
    ]);
    expect(result.steps).toEqual(['Soak the rajma.', 'Pressure-cook until soft.']);
    expect(result.warnings).toEqual([]);
    expect(result.sourceUrl).toBeNull();
  });

  it('rejects input over 4,000 characters with VALIDATION and makes no model call', async () => {
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    await expect(handler(buildEvent('x'.repeat(4001), randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    expect(deps.parseWithModel).not.toHaveBeenCalled();
  });

  it('rejects empty and whitespace-only input with VALIDATION and makes no model call', async () => {
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    await expect(handler(buildEvent('', randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    await expect(handler(buildEvent('   ', randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    expect(deps.parseWithModel).not.toHaveBeenCalled();
  });

  it('the resolver takes no householdId argument and performs no membership check — the deliberate D3 omission, not an oversight', async () => {
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    // The event carries only `text` — a caller from a household this
    // Lambda has never heard of (it has no Aurora access at all) still
    // succeeds, because there is no household-scoped data to protect here.
    const result = await handler(buildEvent('a recipe', randomUUID()));
    expect(result.title).toBe('Rajma Chawal');
  });

  it('enforces the 20/day cap per caller and makes no model call once exhausted', async () => {
    const cognitoSub = randomUUID();
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    for (let i = 0; i < MAX_FREEFORM_PARSES_PER_DAY; i += 1) {
      await expect(handler(buildEvent('a recipe', cognitoSub))).resolves.toBeDefined();
    }
    expect(deps.parseWithModel).toHaveBeenCalledTimes(MAX_FREEFORM_PARSES_PER_DAY);

    // Asserts the exact message, not just the error type: a W7 S12 finding
    // was that this shared limiter can silently leak a *different* action's
    // rate-limit copy (e.g. joinHousehold's "Too many join attempts...")
    // onto this resolver's own cap — `instanceof` alone would never catch
    // that class of regression.
    await expect(handler(buildEvent('a recipe', cognitoSub))).rejects.toThrow(
      `You've reached today's limit of ${MAX_FREEFORM_PARSES_PER_DAY} recipe parses. Try again tomorrow.`,
    );
    expect(deps.parseWithModel).toHaveBeenCalledTimes(MAX_FREEFORM_PARSES_PER_DAY);
  });

  it('isolates the rate-limit budget per caller', async () => {
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);
    const callerA = randomUUID();
    const callerB = randomUUID();

    for (let i = 0; i < MAX_FREEFORM_PARSES_PER_DAY; i += 1) {
      await handler(buildEvent('a recipe', callerA));
    }
    await expect(handler(buildEvent('a recipe', callerA))).rejects.toBeInstanceOf(RateLimitedError);

    // callerB's own budget is untouched by callerA exhausting theirs.
    await expect(handler(buildEvent('a recipe', callerB))).resolves.toBeDefined();
  });

  it('propagates an AI failure un-swallowed, and still consumes the rate-limit unit for that attempt', async () => {
    // The doc comment on the resolver claims a throttled/failed call still
    // only costs the user one of their 20 daily parses — this is the test
    // that actually asserts it, rather than just the comment's own word.
    const cognitoSub = randomUUID();
    const deps = buildDeps({ parseWithModel: vi.fn().mockRejectedValue(new AiTimeoutError()) });
    const handler = createParseFreeformRecipeHandler(deps);

    await expect(handler(buildEvent('a recipe', cognitoSub))).rejects.toBeInstanceOf(AiTimeoutError);
    expect(deps.parseWithModel).toHaveBeenCalledTimes(1);

    // The rate-limit unit for that failed attempt was still spent: only
    // MAX_FREEFORM_PARSES_PER_DAY - 1 further successful calls remain.
    const successDeps = buildDeps({ parseWithModel: vi.fn().mockResolvedValue(wellFormedDraft) });
    const successHandler = createParseFreeformRecipeHandler(successDeps);
    for (let i = 0; i < MAX_FREEFORM_PARSES_PER_DAY - 1; i += 1) {
      await expect(successHandler(buildEvent('a recipe', cognitoSub))).resolves.toBeDefined();
    }
    await expect(successHandler(buildEvent('a recipe', cognitoSub))).rejects.toBeInstanceOf(RateLimitedError);
  });

  it('consumes exactly one rate-limit unit per call regardless of the underlying invokeModel call shape', async () => {
    // parseWithModel here stands in for invokeModel's own internal
    // transport/reinforcement retries (§13.2.7) — from this resolver's
    // perspective it is a single call, so exactly one unit is ever spent
    // per user-initiated mutation, matching §13.2.9's own locked property.
    const cognitoSub = randomUUID();
    const deps = buildDeps();
    const handler = createParseFreeformRecipeHandler(deps);

    await handler(buildEvent('a recipe', cognitoSub));

    for (let i = 1; i < MAX_FREEFORM_PARSES_PER_DAY; i += 1) {
      await handler(buildEvent('a recipe', cognitoSub));
    }
    await expect(handler(buildEvent('a recipe', cognitoSub))).rejects.toBeInstanceOf(RateLimitedError);
    expect(deps.parseWithModel).toHaveBeenCalledTimes(MAX_FREEFORM_PARSES_PER_DAY);
  });
});
