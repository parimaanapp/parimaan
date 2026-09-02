import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { insertRecipe } from '../repositories/recipeRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createCreateMenuHandler } from './createMenu.js';
import type { CreateMenuResolverDeps } from './createMenu.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';

const buildEvent = (
  householdId: unknown,
  weekStartDate: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ householdId: unknown; weekStartDate: unknown }> => ({
  arguments: { householdId, weekStartDate },
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
        } as unknown as AppSyncResolverEvent<{
          householdId: unknown;
          weekStartDate: unknown;
        }>['identity']),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: ['id', 'weekStartDate', 'items'],
    selectionSetGraphQL: '{ id weekStartDate items { id } }',
    parentTypeName: 'Mutation',
    fieldName: 'createMenu',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('createMenu resolver (Mutation.createMenu)', () => {
  let db: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    db = await startTestDatabase();
    pool = new Pool({ connectionString: db.appUri });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await db.stop();
  });

  afterEach(async () => {
    await truncateAll(db.adminClient);
  });

  const baseDeps: CreateMenuResolverDeps = { getPool: async () => pool };

  const createUser = async (cognitoSub: string): Promise<UserRow> => {
    const client = await pool.connect();
    try {
      return await upsertUserByCognitoSub(client, {
        cognitoSub,
        email: `${cognitoSub}@example.test`,
        displayName: null,
        avatarUrl: null,
      });
    } finally {
      client.release();
    }
  };

  const createHouseholdWithMembers = async (
    owner: UserRow,
    inviteCode: string,
    extraMembers: UserRow[] = [],
  ): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const household = await insertHousehold(client, {
          name: `House ${inviteCode}`,
          inviteCode,
          primaryUserId: owner.id,
        });
        await insertMembership(client, { householdId: household.id, userId: owner.id, role: 'primary' });
        await insertDefaultSettings(client, household.id);
        for (const member of extraMembers) {
          await insertMembership(client, { householdId: household.id, userId: member.id, role: 'member' });
        }
        return household.id;
      },
      pool,
    );

  it('rejects a null identity with UnauthorizedError', async () => {
    const owner = await createUser('sub-cm-owner-noidentity');
    const householdId = await createHouseholdWithMembers(owner, 'CMN234');

    const handler = createCreateMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, '2026-09-07T00:00:00.000Z', null)),
    ).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid', 'not-a-uuid', '2026-09-07T00:00:00.000Z'],
    ['absent householdId', undefined, '2026-09-07T00:00:00.000Z'],
    ['malformed weekStartDate', undefined, 'not-a-date'],
  ])('rejects invalid input (%s) with ValidationError', async (_label, householdId, weekStartDate) => {
    const handler = createCreateMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, weekStartDate, 'sub-cm-validation')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an out-of-range calendar date (Feb 30) with ValidationError, not a raw pg date error', async () => {
    const owner = await createUser('sub-cm-owner-cal');
    const householdId = await createHouseholdWithMembers(owner, 'CMC234');

    const handler = createCreateMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, '2026-02-30T00:00:00.000Z', 'sub-cm-owner-cal')),
    ).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-cm-owner-denial');
    const householdId = await createHouseholdWithMembers(owner, 'CMD234');
    await createUser('sub-cm-stranger-denial');

    const handler = createCreateMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-stranger-denial')),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      handler(buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-stranger-denial')),
    ).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent household the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-cm-oracle-probe');
    const handler = createCreateMenuHandler(baseDeps);
    await expect(
      handler(buildEvent(randomUUID(), '2026-09-07T00:00:00.000Z', 'sub-cm-oracle-probe')),
    ).rejects.toThrow(ForbiddenError);
  });

  it('creates an empty-items menu for a fresh week', async () => {
    const owner = await createUser('sub-cm-owner-fresh');
    const householdId = await createHouseholdWithMembers(owner, 'CMF234');

    const handler = createCreateMenuHandler(baseDeps);
    const result = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-owner-fresh'),
    );

    expect(result.householdId).toBe(householdId);
    expect(result.weekStartDate).toBe('2026-09-07T00:00:00.000Z');
    expect(result.items).toEqual([]);
  });

  it('a second call for the same week returns the SAME menu — idempotent, not a second row', async () => {
    const owner = await createUser('sub-cm-owner-idempotent');
    const householdId = await createHouseholdWithMembers(owner, 'CMI234');

    const handler = createCreateMenuHandler(baseDeps);
    const first = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-owner-idempotent'),
    );
    const second = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-owner-idempotent'),
    );

    expect(second.id).toBe(first.id);
    const countResult = await db.adminClient.query('SELECT 1 FROM menus WHERE household_id = $1', [
      householdId,
    ]);
    expect(countResult.rows).toHaveLength(1);
  });

  it('a different week for the same household creates a genuinely separate menu', async () => {
    const owner = await createUser('sub-cm-owner-differentweek');
    const householdId = await createHouseholdWithMembers(owner, 'CMW234');

    const handler = createCreateMenuHandler(baseDeps);
    const first = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-owner-differentweek'),
    );
    const second = await handler(
      buildEvent(householdId, '2026-09-14T00:00:00.000Z', 'sub-cm-owner-differentweek'),
    );

    expect(second.id).not.toBe(first.id);
  });

  it('hydrates existing items with their full recipe when creating over an existing menu', async () => {
    const owner = await createUser('sub-cm-owner-hydrate');
    const householdId = await createHouseholdWithMembers(owner, 'CMH234');
    const handler = createCreateMenuHandler(baseDeps);
    const menu = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-owner-hydrate'),
    );

    await withUserTransaction(
      owner.id,
      async (client) => {
        const recipe = await insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title: 'Rajma',
          description: null,
          servings: 4,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: 'sabzi_dal',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        });
        await client.query(
          `INSERT INTO menu_items (menu_id, recipe_id, day_of_week, meal_slot, slot_role) VALUES ($1, $2, 1, 'lunch', 'sabzi_dal')`,
          [menu.id, recipe.id],
        );
      },
      pool,
    );

    const result = await handler(
      buildEvent(householdId, '2026-09-07T00:00:00.000Z', 'sub-cm-owner-hydrate'),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.recipe.title).toBe('Rajma');
  });
});
