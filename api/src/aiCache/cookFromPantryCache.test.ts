import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDynamoDb } from '../testing/dynamodb.js';
import type { TestDynamoDb } from '../testing/dynamodb.js';
import type { GeminiCookSuggestions } from '../ai/schemas/cookSuggestions.js';
import { COOK_CACHE_TTL_SECONDS, getCachedCookSuggestions, putCachedCookSuggestions } from './cookFromPantryCache.js';

const suggestions: GeminiCookSuggestions = {
  suggestions: [
    {
      title: 'Aloo Jeera',
      description: null,
      servings: 4,
      prepMin: 5,
      cookMin: 20,
      cuisineTier1: 'north_indian',
      cuisineTier2: null,
      dietaryTags: ['veg'],
      role: 'sabzi_dal',
      ingredients: [{ name: 'potato', quantity: '4', unit: 'pcs', notes: null }],
      steps: ['Boil.', 'Temper.'],
    },
  ],
};

describe('cookFromPantryCache', () => {
  let ddb: TestDynamoDb;
  const household = randomUUID();

  beforeAll(async () => {
    ddb = await startTestDynamoDb();
  }, 120_000);
  afterAll(async () => {
    await ddb.stop();
  });

  it('misses on an unknown key', async () => {
    expect(await getCachedCookSuggestions(ddb.client, ddb.tableName, household, 'aaaaaaaaaaaaaaaa')).toBeNull();
  });

  it('round-trips the validated model output', async () => {
    await putCachedCookSuggestions(ddb.client, ddb.tableName, household, 'bbbbbbbbbbbbbbbb', suggestions);
    expect(await getCachedCookSuggestions(ddb.client, ddb.tableName, household, 'bbbbbbbbbbbbbbbb')).toEqual(suggestions);
  });

  it('is scoped to the household: the same content hash under another household is a miss (D5/D11)', async () => {
    await putCachedCookSuggestions(ddb.client, ddb.tableName, household, 'cccccccccccccccc', suggestions);
    expect(await getCachedCookSuggestions(ddb.client, ddb.tableName, randomUUID(), 'cccccccccccccccc')).toBeNull();
  });

  it('writes PK aiCache#cookFromPantry#<household>#<hash> with a 30-minute TTL', async () => {
    const now = new Date('2026-09-29T10:00:00Z');
    await putCachedCookSuggestions(ddb.client, ddb.tableName, household, 'dddddddddddddddd', suggestions, () => now);
    const { Item } = await ddb.client.send(
      new GetCommand({ TableName: ddb.tableName, Key: { PK: `aiCache#cookFromPantry#${household}#dddddddddddddddd`, SK: 'SUGGESTIONS' } }),
    );
    expect(Item?.['ttl']).toBe(Math.floor(now.getTime() / 1000) + COOK_CACHE_TTL_SECONDS);
    expect(COOK_CACHE_TTL_SECONDS).toBe(30 * 60);
  });

  it.each([
    ['a row with no payload', { other: 1 }],
    ['a payload that is not a string', { payload: { suggestions: [] } }],
    ['a payload that is not JSON', { payload: '{not json' }],
    ['a payload of the wrong shape', { payload: JSON.stringify({ suggestions: [{ title: '' }] }) }],
  ])('treats %s as a miss rather than failing the request', async (_label, body) => {
    const hash = randomUUID().replace(/-/g, '').slice(0, 16);
    await ddb.client.send(new PutCommand({ TableName: ddb.tableName, Item: { PK: `aiCache#cookFromPantry#${household}#${hash}`, SK: 'SUGGESTIONS', ...body } }));
    expect(await getCachedCookSuggestions(ddb.client, ddb.tableName, household, hash)).toBeNull();
  });
});
