import { describe, expect, it } from 'vitest';
import { createCacheStore, createIdentityPool, createObjectStore } from './awsPorts.js';

type Sent = { name: string; input: Record<string, unknown> };

const recorder = (responses: Record<string, unknown>[]) => {
  const sent: Sent[] = [];
  const queue = [...responses];
  return {
    sent,
    client: {
      send: async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: command.constructor.name, input: command.input });
        return queue.shift() ?? {};
      },
    },
  };
};

describe('createIdentityPool', () => {
  it('finds users by exact email, paginating, and maps sub', async () => {
    const { client, sent } = recorder([
      {
        Users: [
          { Username: 'Google_1', Attributes: [{ Name: 'sub', Value: 's1' }, { Name: 'email', Value: 'a@x.test' }] },
        ],
        PaginationToken: 'next',
      },
      { Users: [{ Username: 'u2', Attributes: [{ Name: 'sub', Value: 's2' }] }] },
    ]);
    const pool = createIdentityPool(client, 'pool-id');
    const users = await pool.findByEmail('a@x.test');
    expect(users).toEqual([
      { username: 'Google_1', sub: 's1', email: 'a@x.test' },
      { username: 'u2', sub: 's2', email: 'a@x.test' },
    ]);
    expect(sent[0]?.input['Filter']).toBe('email = "a@x.test"');
    expect(sent[0]?.input['UserPoolId']).toBe('pool-id');
    expect(sent[1]?.input['PaginationToken']).toBe('next');
  });

  it('treats UserNotFoundException on delete as success', async () => {
    const client = {
      send: async () => {
        const error = new Error('gone');
        error.name = 'UserNotFoundException';
        throw error;
      },
    };
    await expect(createIdentityPool(client, 'p').deleteUser('x')).resolves.toBeUndefined();
  });

  it('rethrows other delete errors', async () => {
    const client = {
      send: async () => {
        throw new Error('AccessDenied');
      },
    };
    await expect(createIdentityPool(client, 'p').deleteUser('x')).rejects.toThrow('AccessDenied');
  });
});

describe('createObjectStore', () => {
  it('lists every object beneath each prefix, following continuation tokens', async () => {
    const { client, sent } = recorder([
      { Contents: [{ Key: 'pantry-photos/s1/a.jpg' }], IsTruncated: true, NextContinuationToken: 't' },
      { Contents: [{ Key: 'pantry-photos/s1/b.jpg' }], IsTruncated: false },
    ]);
    const store = createObjectStore(client);
    const found = await store.list([{ bucket: 'up', prefix: 'pantry-photos/s1/' }]);
    expect(found.map((o) => o.key)).toEqual(['pantry-photos/s1/a.jpg', 'pantry-photos/s1/b.jpg']);
    expect(sent[1]?.input['ContinuationToken']).toBe('t');
  });

  it('deletes in batches of at most 1000 per bucket', async () => {
    const objects = Array.from({ length: 1001 }, (_, i) => ({ bucket: 'up', key: `k${i}` }));
    const { client, sent } = recorder([{}, {}]);
    await createObjectStore(client).delete(objects);
    expect(sent).toHaveLength(2);
    const first = sent[0]?.input['Delete'] as { Objects: unknown[] };
    expect(first.Objects).toHaveLength(1000);
  });

  it('throws when S3 reports per-object delete errors', async () => {
    const { client } = recorder([{ Errors: [{ Key: 'k', Code: 'AccessDenied' }] }]);
    await expect(
      createObjectStore(client).delete([{ bucket: 'up', key: 'k' }]),
    ).rejects.toThrow(/AccessDenied/);
  });
});

describe('createCacheStore', () => {
  it('scans with a contains filter and returns matching keys', async () => {
    const { client, sent } = recorder([
      { Items: [{ PK: 'RATELIMIT#join#u1', SK: 'd' }], LastEvaluatedKey: { PK: 'x', SK: 'y' } },
      { Items: [{ PK: 'aiCache#cook#h1#abc', SK: 'v' }] },
    ]);
    const store = createCacheStore(client, 'cache-table');
    const keys = await store.findByIdentifiers(['u1', 'h1']);
    expect(keys).toEqual([
      { pk: 'RATELIMIT#join#u1', sk: 'd' },
      { pk: 'aiCache#cook#h1#abc', sk: 'v' },
    ]);
    expect(sent[0]?.input['TableName']).toBe('cache-table');
    expect(String(sent[0]?.input['FilterExpression'])).toContain('contains(PK, :id0)');
    expect(sent[1]?.input['ExclusiveStartKey']).toEqual({ PK: 'x', SK: 'y' });
  });

  it('deletes each key', async () => {
    const { client, sent } = recorder([{}, {}]);
    await createCacheStore(client, 't').delete([
      { pk: 'a', sk: '1' },
      { pk: 'b', sk: '2' },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.input['Key']).toEqual({ PK: 'a', SK: '1' });
  });
});
