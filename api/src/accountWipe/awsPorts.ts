import {
  AdminDeleteUserCommand,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
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

export const createIdentityPool = (client: SendClient, userPoolId: string): IdentityPool => ({
  findByEmail: async (email) => {
    if (email.includes('"')) {
      throw new Error(`Refusing to build a Cognito filter from "${email}".`);
    }
    const users: CognitoUser[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Filter: `email = "${email}"`,
          ...(token !== undefined ? { PaginationToken: token } : {}),
        }),
      );
      for (const user of page.Users ?? []) {
        const sub = attribute(user.Attributes, 'sub');
        if (user.Username !== undefined && sub !== undefined) {
          users.push({ username: user.Username, sub, email });
        }
      }
      token = page.PaginationToken;
    } while (token !== undefined);
    return users;
  },

  deleteUser: async (username) => {
    try {
      await client.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
    } catch (error) {
      if (error instanceof Error && error.name === 'UserNotFoundException') {
        return;
      }
      throw error;
    }
  },
});

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
 * rate-limit items keyed by household/user ids, so a filtered Scan is cheap
 * and needs no index. Items are matched by identifier appearing in `PK`.
 */
export const createCacheStore = (client: SendClient, tableName: string): CacheStore => ({
  findByIdentifiers: async (identifiers) => {
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
          const key = { pk: String(item['PK']), sk: String(item['SK']) };
          found.set(`${key.pk}|${key.sk}`, key);
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
