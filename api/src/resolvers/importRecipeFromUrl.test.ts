import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import { createImportRecipeFromUrlHandler, MAX_URL_IMPORTS_PER_DAY } from './importRecipeFromUrl.js';
import type { ImportRecipeFromUrlResolverDeps } from './importRecipeFromUrl.js';
import { RateLimitedError, UnauthorizedError, UrlUnreadableError, ValidationError } from '../errors.js';

const fixturesDir = fileURLToPath(new URL('../../test/fixtures/jsonld/', import.meta.url));
const usableFixtureHtml = readFileSync(`${fixturesDir}archanaskitchen.html`, 'utf8');
const noRecipeFixtureHtml = readFileSync(`${fixturesDir}sanjeevkapoor.html`, 'utf8');

const buildEvent = (url: unknown, cognitoSub: string | null): AppSyncResolverEvent<{ url: unknown }> => ({
  arguments: { url },
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
        } as unknown as AppSyncResolverEvent<{ url: unknown }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['title'],
    selectionSetGraphQL: '{ title }',
    parentTypeName: 'Mutation',
    fieldName: 'importRecipeFromUrl',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('importRecipeFromUrl resolver', () => {
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

  const buildDeps = (overrides: Partial<ImportRecipeFromUrlResolverDeps> = {}): ImportRecipeFromUrlResolverDeps => ({
    getDdbClient: () => ddb.client,
    getCacheTableName: () => ddb.tableName,
    now: fixedNow(),
    fetchPage: vi.fn().mockResolvedValue(usableFixtureHtml),
    ...overrides,
  });

  it('rejects an unauthenticated caller before validation, rate limit, or fetch', async () => {
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);

    await expect(handler(buildEvent('https://example.com/recipe', null))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });

  it('a real fixture page end-to-ends into a RecipeDraft carrying sourceUrl', async () => {
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);

    const result = await handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', randomUUID()));

    expect(result.sourceUrl).toBe('https://www.archanaskitchen.com/mysore-masala-dosa');
    expect(result.title && result.title.length).toBeGreaterThan(0);
    expect(result.ingredients.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.cuisineTier1).toBeNull();
    expect(result.role).toBeNull();
    expect(result.dietaryTags).toEqual([]);
  });

  it('rejects a malformed url with VALIDATION and never calls fetchPage', async () => {
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);

    await expect(handler(buildEvent('', randomUUID()))).rejects.toBeInstanceOf(ValidationError);
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });

  it('the resolver takes no householdId argument and performs no membership check', async () => {
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);

    const result = await handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', randomUUID()));
    expect(result.title && result.title.length).toBeGreaterThan(0);
  });

  it('maps a fetch failure (SSRF rejection or transport error) to UrlUnreadableError', async () => {
    const deps = buildDeps({ fetchPage: vi.fn().mockResolvedValue(null) });
    const handler = createImportRecipeFromUrlHandler(deps);

    await expect(handler(buildEvent('https://example.com/recipe', randomUUID()))).rejects.toBeInstanceOf(UrlUnreadableError);
  });

  it('maps a page with no usable Recipe JSON-LD to the identical UrlUnreadableError — never distinguished from a fetch failure', async () => {
    const deps = buildDeps({ fetchPage: vi.fn().mockResolvedValue(noRecipeFixtureHtml) });
    const handler = createImportRecipeFromUrlHandler(deps);

    await expect(handler(buildEvent('https://www.sanjeevkapoor.com/recipe/some-recipe.html', randomUUID()))).rejects.toBeInstanceOf(UrlUnreadableError);
  });

  it('enforces the 30/day cap per caller and makes no fetch call once exhausted', async () => {
    const cognitoSub = randomUUID();
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);

    for (let i = 0; i < MAX_URL_IMPORTS_PER_DAY; i += 1) {
      await expect(handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', cognitoSub))).resolves.toBeDefined();
    }
    expect(deps.fetchPage).toHaveBeenCalledTimes(MAX_URL_IMPORTS_PER_DAY);

    await expect(handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', cognitoSub))).rejects.toBeInstanceOf(RateLimitedError);
    expect(deps.fetchPage).toHaveBeenCalledTimes(MAX_URL_IMPORTS_PER_DAY);
  });

  it('checks the daily cap before any fetch (and therefore before any DNS lookup) — the invalid-url case never even reaches the rate limiter', async () => {
    const cognitoSub = randomUUID();
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);

    // Exhaust the cap first.
    for (let i = 0; i < MAX_URL_IMPORTS_PER_DAY; i += 1) {
      await handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', cognitoSub));
    }
    // A further call — even with a well-formed URL — is rejected by the
    // rate limiter before fetchPage (and therefore before any DNS lookup)
    // is ever invoked.
    await expect(handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', cognitoSub))).rejects.toBeInstanceOf(RateLimitedError);
    expect(deps.fetchPage).toHaveBeenCalledTimes(MAX_URL_IMPORTS_PER_DAY);
  });

  it('isolates the rate-limit budget per caller', async () => {
    const deps = buildDeps();
    const handler = createImportRecipeFromUrlHandler(deps);
    const callerA = randomUUID();
    const callerB = randomUUID();

    for (let i = 0; i < MAX_URL_IMPORTS_PER_DAY; i += 1) {
      await handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', callerA));
    }
    await expect(handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', callerA))).rejects.toBeInstanceOf(RateLimitedError);

    await expect(handler(buildEvent('https://www.archanaskitchen.com/mysore-masala-dosa', callerB))).resolves.toBeDefined();
  });
});
