import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import type * as NodeFs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __loadCuratedRecipesFromDirForTests,
  __resetCuratedRecipesCacheForTests,
  getCuratedRecipesFromCorpus,
} from './curatedRecipes.js';

/**
 * `vi.spyOn(fs, 'readdirSync')` cannot patch a `node:fs` ESM namespace
 * directly ("Module namespace is not configurable in ESM" — Vitest's own
 * limitation note). `vi.mock` with `importOriginal` is the standard
 * ESM-safe workaround: it swaps in a partial mock whose `readdirSync`/
 * `readFileSync` are `vi.fn()`-wrapped versions of the real
 * implementations (still doing real filesystem I/O, just observable via
 * `.mock.calls`), and every other export passes through unchanged.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    readdirSync: vi.fn(actual.readdirSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

/**
 * W16 S5 RED tests — the real production `GetCuratedRecipesFn`
 * (`getCuratedRecipesFromCorpus`) that reads/parses/validates the curated
 * JSON corpus off disk, caches module-level, and fails loudly on a
 * malformed file. See E2E_MVP_PLAN.md §22.3 S5's own RED-test list.
 *
 * `__resetCuratedRecipesCacheForTests` clears the module-level cache
 * between tests so each test observes a fresh read rather than another
 * test's cached result — the cache itself is otherwise process-lifetime,
 * matching the real Lambda's warm-instance behavior.
 */
describe('getCuratedRecipesFromCorpus', () => {
  beforeEach(() => {
    __resetCuratedRecipesCacheForTests();
  });

  afterEach(() => {
    // `vi.clearAllMocks()`, not `restoreAllMocks()` — the `readdirSync`/
    // `readFileSync` mocks above are `vi.fn(actual.impl)` wrappers set up
    // once via `vi.mock`'s factory (not `vi.spyOn`), so `restoreAllMocks`
    // would tear down their real-implementation wiring for every later
    // test in this file; `clearAllMocks` only resets call history.
    vi.clearAllMocks();
    __resetCuratedRecipesCacheForTests();
  });

  it('returns exactly 53 recipes from the real recipes/ corpus (30 north-indian + 23 south-indian)', () => {
    const recipes = getCuratedRecipesFromCorpus();
    expect(recipes).toHaveLength(53);
  });

  it('returns recipes with the correct shape, including the Dosa duplicate-role experiment (carb + breakfast)', () => {
    const recipes = getCuratedRecipesFromCorpus();

    // Every recipe is a fully-parsed, schema-valid object with the fields
    // `RecipeInput`/`curatedRecipeInputSchema` require.
    for (const recipe of recipes) {
      expect(typeof recipe.title).toBe('string');
      expect(recipe.title.length).toBeGreaterThan(0);
      expect(Array.isArray(recipe.ingredients)).toBe(true);
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      expect(Array.isArray(recipe.steps)).toBe(true);
      expect(recipe.steps.length).toBeGreaterThan(0);
      expect(typeof recipe.role).toBe('string');
    }

    // The deliberate duplicate-role experiment: `dosa-carb.json` and
    // `dosa-breakfast.json` are two distinct Dosa recipes, one with
    // role `carb`, one with role `breakfast`.
    const dosaRoles = recipes
      .filter((recipe) => recipe.title.toLowerCase().startsWith('dosa'))
      .map((recipe) => recipe.role);
    expect(dosaRoles).toContain('carb');
    expect(dosaRoles).toContain('breakfast');
  });

  it('reads the filesystem once and caches the result — a second call does not re-read', () => {
    const readdirMock = fs.readdirSync as unknown as ReturnType<typeof vi.fn>;
    const readFileMock = fs.readFileSync as unknown as ReturnType<typeof vi.fn>;
    readdirMock.mockClear();
    readFileMock.mockClear();

    const first = getCuratedRecipesFromCorpus();
    const readdirCallsAfterFirst = readdirMock.mock.calls.length;
    const readFileCallsAfterFirst = readFileMock.mock.calls.length;
    expect(readFileCallsAfterFirst).toBeGreaterThan(0);

    const second = getCuratedRecipesFromCorpus();

    expect(second).toBe(first); // same cached array reference
    expect(readdirMock.mock.calls.length).toBe(readdirCallsAfterFirst);
    expect(readFileMock.mock.calls.length).toBe(readFileCallsAfterFirst);
  });

  describe('against a fixture directory with a malformed file', () => {
    let fixtureRoot: string;

    beforeEach(async () => {
      fixtureRoot = await mkdtemp(join(tmpdir(), 'parimaan-curated-recipes-'));
      mkdirSync(join(fixtureRoot, 'north-indian'), { recursive: true });
      mkdirSync(join(fixtureRoot, 'south-indian'), { recursive: true });
    });

    afterEach(async () => {
      await rm(fixtureRoot, { recursive: true, force: true });
    });

    it('throws (does not silently skip) when a curated file fails schema validation', async () => {
      // Missing required fields (`role`, `ingredients`, `steps`) — fails
      // `curatedRecipeInputSchema`.
      await writeFile(
        join(fixtureRoot, 'north-indian', 'broken.json'),
        JSON.stringify({ title: 'Broken Recipe' }),
      );

      expect(() => __loadCuratedRecipesFromDirForTests(fixtureRoot)).toThrow(
        /failed validation/,
      );
    });

    it('throws (does not silently skip) when a curated file is not valid JSON', async () => {
      await writeFile(join(fixtureRoot, 'north-indian', 'not-json.json'), '{ this is not json');

      expect(() => __loadCuratedRecipesFromDirForTests(fixtureRoot)).toThrow(
        /not valid JSON/,
      );
    });

    it('does not silently reduce the seeded set: one malformed file among valid ones still throws, not a partial list', async () => {
      const validRecipe = {
        title: 'Fixture Dal',
        description: 'A valid fixture recipe.',
        servings: 4,
        prepMin: 10,
        cookMin: 20,
        cuisineTier1: 'north_indian',
        cuisineTier2: null,
        dietaryTags: ['veg'],
        role: 'sabzi_dal',
        inRotation: true,
        ingredients: [{ name: 'Toor dal', quantity: 1, unit: 'cup', category: 'pantry', notes: null, isStaple: true }],
        steps: ['Boil the dal.'],
      };
      await writeFile(join(fixtureRoot, 'north-indian', 'good.json'), JSON.stringify(validRecipe));
      await writeFile(
        join(fixtureRoot, 'north-indian', 'broken.json'),
        JSON.stringify({ title: 'Broken Recipe' }),
      );

      expect(() => __loadCuratedRecipesFromDirForTests(fixtureRoot)).toThrow();
    });
  });
});
