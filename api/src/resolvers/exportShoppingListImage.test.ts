import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { startTestDatabase, truncateAll } from '../testing/postgres.js';
import type { TestDatabase } from '../testing/postgres.js';
import { withUserTransaction } from '../db/withUserTransaction.js';
import { upsertUserByCognitoSub } from '../repositories/userRepository.js';
import { insertDefaultSettings, insertHousehold, insertMembership } from '../repositories/householdRepository.js';
import { insertRecipe } from '../repositories/recipeRepository.js';
import { insertShoppingList, insertShoppingListItems } from '../repositories/shoppingListRepository.js';
import type { NewShoppingListItemInput } from '../repositories/shoppingListRepository.js';
import type { UserRow } from '../repositories/userRepository.js';
import { createExportShoppingListImageHandler } from './exportShoppingListImage.js';
import type { ExportShoppingListImageResolverDeps } from './exportShoppingListImage.js';
import { buildExportShoppingListImageKey, EXPORT_PRESIGN_EXPIRY_SECONDS } from '../exports/presignShoppingListImageUpload.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../errors.js';

const DENIAL_MESSAGE = 'You are not a member of this household.';
const BUCKET_NAME = 'parimaan-exports-test';

const identityFor = (cognitoSub: string | null): AppSyncResolverEvent<unknown>['identity'] =>
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
      } as unknown as AppSyncResolverEvent<unknown>['identity']);

const buildEvent = (
  listId: unknown,
  cognitoSub: string | null,
): AppSyncResolverEvent<{ listId: unknown }> => ({
  arguments: { listId },
  identity: identityFor(cognitoSub),
  source: null,
  request: { headers: {}, domainName: null },
  info: {
    selectionSetList: [],
    selectionSetGraphQL: '',
    parentTypeName: 'Mutation',
    fieldName: 'exportShoppingListImage',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('exportShoppingListImage resolver (Mutation.exportShoppingListImage)', () => {
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

  // Dummy, fixed credentials/region — `getSignedUrl` is a pure local SigV4
  // computation with no network call, so this never touches real AWS; it
  // just needs a resolvable credential provider instead of the default
  // chain (which would otherwise try env/IMDS lookups in this environment).
  const testS3Client = new S3Client({
    region: 'ap-south-1',
    credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
  });

  const baseDeps: ExportShoppingListImageResolverDeps = {
    getPool: async () => pool,
    getBucketName: () => BUCKET_NAME,
    getS3Client: () => testS3Client,
  };

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

  const createHouseholdWithOwner = async (owner: UserRow, inviteCode: string): Promise<string> =>
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
        return household.id;
      },
      pool,
    );

  const seedRecipeId = async (owner: UserRow, householdId: string): Promise<string> =>
    withUserTransaction(
      owner.id,
      async (client) => {
        const recipe = await insertRecipe(client, {
          householdId,
          sourceType: 'user',
          sourceUrl: null,
          title: 'exportShoppingListImage test recipe',
          description: null,
          servings: 4,
          prepMin: null,
          cookMin: null,
          cuisineTier1: null,
          cuisineTier2: null,
          dietaryTags: [],
          role: 'carb',
          inRotation: true,
          steps: [],
          createdBy: owner.id,
        });
        return recipe.id;
      },
      pool,
    );

  /** Seeds a fresh shopping list (no menu) with one item. Returns the list's id. */
  const seedShoppingList = async (
    owner: UserRow,
    householdId: string,
    item: Omit<NewShoppingListItemInput, 'sourceRecipeId'>,
  ): Promise<string> => {
    const sourceRecipeId = await seedRecipeId(owner, householdId);
    return withUserTransaction(
      owner.id,
      async (client) => {
        const list = await insertShoppingList(client, { householdId, generatedFromMenuId: null });
        await insertShoppingListItems(client, list.id, [{ ...item, sourceRecipeId }]);
        return list.id;
      },
      pool,
    );
  };

  it('rejects a null identity with UnauthorizedError', async () => {
    const handler = createExportShoppingListImageHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), null))).rejects.toThrow(UnauthorizedError);
  });

  it.each([
    ['not a uuid listId', 'not-a-uuid'],
    ['absent listId', undefined],
    ['explicit null listId', null],
  ])('rejects a %s with ValidationError', async (_label, listId) => {
    const handler = createExportShoppingListImageHandler(baseDeps);
    await expect(handler(buildEvent(listId, 'sub-export-validation'))).rejects.toThrow(ValidationError);
  });

  it('denies a non-member with the exact requireHouseholdMember denial message', async () => {
    const owner = await createUser('sub-export-owner-denial');
    const householdId = await createHouseholdWithOwner(owner, 'EXP001');
    const listId = await seedShoppingList(owner, householdId, {
      name: 'toor dal',
      quantity: 500,
      unit: 'g',
      category: 'dal',
    });
    await createUser('sub-export-stranger-denial');

    const handler = createExportShoppingListImageHandler(baseDeps);
    await expect(handler(buildEvent(listId, 'sub-export-stranger-denial'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(listId, 'sub-export-stranger-denial'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('gives a nonexistent listId the SAME denial as a non-member — never an existence oracle', async () => {
    await createUser('sub-export-oracle');
    const handler = createExportShoppingListImageHandler(baseDeps);
    await expect(handler(buildEvent(randomUUID(), 'sub-export-oracle'))).rejects.toThrow(ForbiddenError);
    await expect(handler(buildEvent(randomUUID(), 'sub-export-oracle'))).rejects.toThrow(DENIAL_MESSAGE);
  });

  it('a household member gets back a presigned PUT URL matching the exports/{householdId}/{listId}/{timestamp}.png convention', async () => {
    const owner = await createUser('sub-export-member-ok');
    const householdId = await createHouseholdWithOwner(owner, 'EXP002');
    const listId = await seedShoppingList(owner, householdId, {
      name: 'milk',
      quantity: 1,
      unit: 'liter',
      category: 'dairy',
    });

    const fixedNow = new Date('2026-09-12T10:00:00.000Z');
    const handler = createExportShoppingListImageHandler({ ...baseDeps, now: () => fixedNow });
    const url = await handler(buildEvent(listId, 'sub-export-member-ok'));

    expect(typeof url).toBe('string');
    const parsed = new URL(url);
    // The presigned URL must target this bucket's own virtual-hosted or
    // path-style endpoint — the exact host shape depends on the SDK/region,
    // but the bucket name and the expected key are always present somewhere
    // in the URL (host or path), and the expected key is always present in
    // the path per S3's presigning contract.
    expect(parsed.hostname.includes(BUCKET_NAME) || parsed.pathname.includes(BUCKET_NAME)).toBe(true);
    const expectedKey = buildExportShoppingListImageKey(householdId, listId, fixedNow);
    expect(decodeURIComponent(parsed.pathname)).toContain(expectedKey);
  });

  it('the presigned URL expiry is approximately 10 minutes from generation time', async () => {
    const owner = await createUser('sub-export-expiry');
    const householdId = await createHouseholdWithOwner(owner, 'EXP003');
    const listId = await seedShoppingList(owner, householdId, {
      name: 'onion',
      quantity: 2,
      unit: 'piece',
      category: 'produce',
    });

    const fixedNow = new Date('2026-09-12T10:00:00.000Z');
    const handler = createExportShoppingListImageHandler({ ...baseDeps, now: () => fixedNow });
    const url = await handler(buildEvent(listId, 'sub-export-expiry'));

    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(EXPORT_PRESIGN_EXPIRY_SECONDS));

    // X-Amz-Date is ISO-8601 basic format (YYYYMMDDTHHMMSSZ, no
    // milliseconds) — derived here from the SAME injected clock rather than
    // hand-parsed, so this directly proves the "approximately 10 minutes
    // from generation time" claim is anchored to the actual call time.
    const expectedAmzDate = `${fixedNow.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
    expect(parsed.searchParams.get('X-Amz-Date')).toBe(expectedAmzDate);
  });
});
