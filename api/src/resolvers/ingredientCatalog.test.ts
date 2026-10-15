import { describe, expect, it } from 'vitest';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { createIngredientCatalogHandler } from './ingredientCatalog.js';
import { createSearchIngredientsHandler } from './searchIngredients.js';
import { UnauthorizedError, ValidationError } from '../errors.js';
import { buildCatalogIndex } from '../domain/ingredientCatalog.js';
import type { CatalogEntry } from '../domain/ingredientCatalog.js';

const entry = (
  id: string,
  canonicalName: string,
  appCategory: string,
  aliases: string[] = [],
): CatalogEntry => ({
  id,
  canonicalName,
  appCategory,
  subcategory: appCategory,
  allowedUnits: ['g', 'kg'],
  defaultUnit: 'g',
  pieceG: null,
  cupG: null,
  note: '',
  aliases,
});

const ENTRIES: CatalogEntry[] = [
  entry('toor_dal', 'Toor Dal', 'dal', ['arhar dal', 'tuvar dal']),
  entry('moong_dal', 'Moong Dal', 'dal', ['mung dal']),
  entry('milk', 'Milk', 'dairy', ['doodh']),
  entry('meat_chicken', 'Chicken', 'meat_fish', ['murgh']),
];
const catalog = { entries: ENTRIES, index: buildCatalogIndex(ENTRIES) };
const deps = { getCatalog: async () => catalog };

const identity = {
  sub: 'fake-sub',
  issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/pool',
  username: 'fake',
  claims: { email: 'fake@example.test' },
  sourceIp: ['127.0.0.1'],
  defaultAuthStrategy: 'ALLOW',
  groups: null,
};

const event = <Args>(args: Args, authenticated = true): AppSyncResolverEvent<Args> =>
  ({
    arguments: args,
    identity: authenticated ? identity : null,
    source: null,
    request: { headers: {}, domainName: null },
    info: {
      selectionSetList: [],
      selectionSetGraphQL: '',
      parentTypeName: 'Query',
      fieldName: 'x',
      variables: {},
    },
    prev: null,
    stash: {},
  }) as unknown as AppSyncResolverEvent<Args>;

describe('Query.ingredientCatalog', () => {
  const handler = createIngredientCatalogHandler(deps);

  it('rejects unauthenticated callers', async () => {
    await expect(handler(event({ category: null }, false))).rejects.toThrow(UnauthorizedError);
  });

  it('returns every ingredient with the documented fields, sorted by name', async () => {
    const result = await handler(event({ category: null }));
    expect(result.map((item) => item.name)).toEqual(['Chicken', 'Milk', 'Moong Dal', 'Toor Dal']);
    const toor = result.find((item) => item.id === 'toor_dal');
    expect(toor).toEqual({
      id: 'toor_dal',
      name: 'Toor Dal',
      category: 'dal',
      categoryLabel: 'Dal',
      allowedUnits: ['g', 'kg'],
      defaultUnit: 'g',
      aliases: ['arhar dal', 'tuvar dal'],
    });
  });

  it('labels categories with the approved copy', async () => {
    const result = await handler(event({ category: 'meat_fish' }));
    expect(result).toHaveLength(1);
    expect(result[0]?.categoryLabel).toBe('Meat & Fish');
  });

  it('filters by category case-insensitively and trims', async () => {
    const result = await handler(event({ category: '  DAL ' }));
    expect(result.map((item) => item.id)).toEqual(['moong_dal', 'toor_dal']);
  });

  it('treats an empty category as no filter', async () => {
    expect(await handler(event({ category: '' }))).toHaveLength(4);
    expect(await handler(event({}))).toHaveLength(4);
  });

  it('returns an empty list for an unknown category rather than an error', async () => {
    expect(await handler(event({ category: 'electronics' }))).toEqual([]);
  });

  it('rejects an absurdly long category', async () => {
    await expect(handler(event({ category: 'x'.repeat(100) }))).rejects.toThrow(ValidationError);
  });

  it('does not leak the underlying entries (returns copies)', async () => {
    const result = await handler(event({ category: null }));
    (result[0]?.aliases as string[]).push('mutated');
    const again = await handler(event({ category: null }));
    expect(again.flatMap((item) => item.aliases)).not.toContain('mutated');
  });
});

describe('Query.searchIngredients', () => {
  const handler = createSearchIngredientsHandler(deps);

  it('rejects unauthenticated callers', async () => {
    await expect(handler(event({ query: 'milk' }, false))).rejects.toThrow(UnauthorizedError);
  });

  it('finds by canonical name and by alias', async () => {
    expect((await handler(event({ query: 'milk' }))).map((item) => item.id)).toEqual(['milk']);
    expect((await handler(event({ query: 'doodh' }))).map((item) => item.id)).toEqual(['milk']);
    expect((await handler(event({ query: 'arhar' }))).map((item) => item.id)).toEqual(['toor_dal']);
  });

  it('applies the default limit of 20 and an explicit limit', async () => {
    expect(await handler(event({ query: 'dal', limit: 1 }))).toHaveLength(1);
    expect((await handler(event({ query: 'dal' }))).length).toBe(2);
  });

  it('clamps an out-of-range limit instead of failing', async () => {
    expect(await handler(event({ query: 'dal', limit: 0 }))).toHaveLength(1);
    expect(await handler(event({ query: 'dal', limit: 100000 }))).toHaveLength(2);
  });

  it('returns an empty list for a blank query', async () => {
    expect(await handler(event({ query: '   ' }))).toEqual([]);
  });

  it('rejects a query longer than 100 characters', async () => {
    await expect(handler(event({ query: 'a'.repeat(101) }))).rejects.toThrow(ValidationError);
  });

  it('rejects a non-string query', async () => {
    await expect(handler(event({ query: 42 as unknown as string }))).rejects.toThrow(ValidationError);
  });

  it('includes category labels and aliases on results', async () => {
    const [first] = await handler(event({ query: 'chicken' }));
    expect(first).toMatchObject({ id: 'meat_chicken', categoryLabel: 'Meat & Fish', aliases: ['murgh'] });
  });
});
