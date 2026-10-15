import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { assertUuidIdentifiers } from './identifiers.js';
import type { CacheKey, CacheStore, CognitoUser, IdentityPool, ObjectRef, ObjectStore } from './types.js';

/** Minimal structural client type: any AWS SDK v3 client (or a test double) satisfies it. */
export interface SendClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(command: any): Promise<any>;
}

const S3_DELETE_BATCH = 1000;
const SCAN_FILTER_CHUNK = 20;

const attribute = (
  attributes: readonly { Name?: string; Value?: string }[] | undefined,
  name: string,
): string | undefined => attributes?.find((a) => a.Name === name)?.Value;

const notFoundIsSuccess = async (action: () => Promise<unknown>): Promise<void> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.name === 'UserNotFoundException') {
      return;
    }
    throw error;
  }
};

const listUsers = async (
  client: SendClient,
  userPoolId: string,
  filter: string,
  keep: (user: CognitoUser) => boolean,
  fallbackEmail: string,
): Promise<CognitoUser[]> => {
  const users: CognitoUser[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: filter,
        ...(token !== undefined ? { PaginationToken: token } : {}),
      }),
    );
    for (const user of page.Users ?? []) {
      const sub = attribute(user.Attributes, 'sub');
      if (user.Username === undefined || sub === undefined) continue;
      const candidate: CognitoUser = {
        username: user.Username,
        sub,
        email: attribute(user.Attributes, 'email') ?? fallbackEmail,
      };
      if (keep(candidate)) users.push(candidate);
    }
    token = page.PaginationToken;
  } while (token !== undefined);
  return users;
};

export const createIdentityPool = (client: SendClient, userPoolId: string): IdentityPool => {
  const listByFilter = (
    filter: string,
    keep: (user: CognitoUser) => boolean,
    fallbackEmail: string,
  ): Promise<CognitoUser[]> => listUsers(client, userPoolId, filter, keep, fallbackEmail);

  const assertFilterSafe = (value: string): void => {
    if (value.includes('"') || value.includes('\\')) {
      throw new Error(`Refusing to build a Cognito filter from "${value}".`);
    }
  };

  return {
    findByEmail: async (email) => {
      assertFilterSafe(email);
      const wanted = email.toLowerCase();
      return listByFilter(`email = "${email}"`, (u) => u.email.toLowerCase() === wanted, email);
    },

    findBySub: async (sub) => {
      assertFilterSafe(sub);
      return listByFilter(`sub = "${sub}"`, (u) => u.sub === sub, '');
    },

    disableUser: (username) =>
      notFoundIsSuccess(() =>
        client.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username })),
      ),

    deleteUser: (username) =>
      notFoundIsSuccess(() =>
        client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username })),
      ),
  };
};

export const createObjectStore = (client: SendClient): ObjectStore => ({
  list: async (prefixes) => {
    const found: ObjectRef[] = [];
    for (const { bucket, prefix } of prefixes) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(token !== undefined ? { ContinuationToken: token } : {}),
          }),
        );
        for (const item of page.Contents ?? []) {
          if (item.Key !== undefined) {
            found.push({ bucket, key: item.Key });
          }
        }
        token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
    }
    return found;
  },

  delete: async (objects) => {
    const byBucket = new Map<string, string[]>();
    for (const { bucket, key } of objects) {
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), key]);
    }
    for (const [bucket, keys] of byBucket) {
      for (let i = 0; i < keys.length; i += S3_DELETE_BATCH) {
        const batch = keys.slice(i, i + S3_DELETE_BATCH);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        const errors: { Key?: string; Code?: string }[] = result?.Errors ?? [];
        if (errors.length > 0) {
          const detail = errors.map((e) => `${e.Key ?? '?'}: ${e.Code ?? 'unknown'}`).join(', ');
          throw new Error(`S3 delete failed for ${errors.length} object(s): ${detail}`);
        }
      }
    }
  },
});

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * The cache table (`parimaan-cache-<env>`) holds only TTL-expiring cache and
 * rate-limit items whose partition key is `#`-separated:
 * `RATELIMIT#<action>#<userId>` and `aiCache#cookFromPantry#<householdId>#<hash>`.
 * A filtered Scan narrows server-side with `contains`, then an item is kept only
 * if one `#` segment of PK equals an identifier exactly, so a prefix or
 * substring of another identifier can never match. Every identifier must be a UUID.
 */
export const createCacheStore = (client: SendClient, tableName: string): CacheStore => ({
  findByIdentifiers: async (identifiers) => {
    assertUuidIdentifiers(identifiers.map((value) => ({ kind: 'cache identifier', value })));
    const wanted = new Set(identifiers.map((id) => id.toLowerCase()));
    const found = new Map<string, CacheKey>();
    for (const ids of chunk(identifiers, SCAN_FILTER_CHUNK)) {
      const values = Object.fromEntries(ids.map((id, i) => [`:id${i}`, id]));
      const filter = ids.map((_, i) => `contains(PK, :id${i})`).join(' OR ');
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await client.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: filter,
            ExpressionAttributeValues: values,
            ProjectionExpression: 'PK, SK',
            ...(startKey !== undefined ? { ExclusiveStartKey: startKey } : {}),
          }),
        );
        for (const item of page.Items ?? []) {
          const pk: unknown = item['PK'];
          const sk: unknown = item['SK'];
          if (typeof pk !== 'string' || typeof sk !== 'string') continue;
          if (!pk.split('#').some((segment) => wanted.has(segment.toLowerCase()))) continue;
          found.set(`${pk}|${sk}`, { pk, sk });
        }
        startKey = page.LastEvaluatedKey;
      } while (startKey !== undefined);
    }
    return [...found.values()];
  },

  delete: async (keys) => {
    for (const { pk, sk } of keys) {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { PK: pk, SK: sk } }));
    }
  },
});
