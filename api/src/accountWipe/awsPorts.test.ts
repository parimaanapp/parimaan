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

  it('matches case-insensitively on the returned email and reports the stored email', async () => {
    const { client, sent } = recorder([
      {
        Users: [
          { Username: 'u1', Attributes: [{ Name: 'sub', Value: 's1' }, { Name: 'email', Value: 'A@X.test' }] },
          { Username: 'u2', Attributes: [{ Name: 'sub', Value: 's2' }, { Name: 'email', Value: 'a@x.test.evil' }] },
        ],
      },
    ]);
    const users = await createIdentityPool(client, 'p').findByEmail('A@X.test');
    expect(users).toEqual([{ username: 'u1', sub: 's1', email: 'A@X.test' }]);
    expect(sent[0]?.input['Filter']).toBe('email = "A@X.test"');
  });

  it('finds users by exact sub', async () => {
    const { client, sent } = recorder([
      { Users: [{ Username: 'u1', Attributes: [{ Name: 'sub', Value: 's1' }, { Name: 'email', Value: 'z@x.test' }] }] },
    ]);
    const users = await createIdentityPool(client, 'p').findBySub('s1');
    expect(users).toEqual([{ username: 'u1', sub: 's1', email: 'z@x.test' }]);
    expect(sent[0]?.input['Filter']).toBe('sub = "s1"');
  });

  it('refuses to build a filter from a sub containing a quote', async () => {
    const { client } = recorder([]);
    await expect(createIdentityPool(client, 'p').findBySub('a"b')).rejects.toThrow(/Refusing/);
  });

  it('disables a user, treating UserNotFoundException as success', async () => {
    const { client, sent } = recorder([{}]);
    await createIdentityPool(client, 'p').disableUser('u1');
    expect(sent[0]?.name).toBe('AdminDisableUserCommand');
    expect(sent[0]?.input).toEqual({ UserPoolId: 'p', Username: 'u1' });
    const gone = {
      send: async () => {
        const error = new Error('gone');
        error.name = 'UserNotFoundException';
        throw error;
      },
    };
    await expect(createIdentityPool(gone, 'p').disableUser('x')).resolves.toBeUndefined();
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

const U1 = '11111111-1111-4111-8111-111111111111';
const H1 = '22222222-2222-4222-8222-222222222222';

describe('createCacheStore', () => {
  it('scans with a contains prefilter and returns keys whose PK has an exactly matching segment', async () => {
    const { client, sent } = recorder([
      { Items: [{ PK: `RATELIMIT#join#${U1}`, SK: 'd' }], LastEvaluatedKey: { PK: 'x', SK: 'y' } },
      { Items: [{ PK: `aiCache#cook#${H1}#abc`, SK: 'v' }] },
    ]);
    const store = createCacheStore(client, 'cache-table');
    const keys = await store.findByIdentifiers([U1, H1]);
    expect(keys).toEqual([
      { pk: `RATELIMIT#join#${U1}`, sk: 'd' },
      { pk: `aiCache#cook#${H1}#abc`, sk: 'v' },
    ]);
    expect(sent[0]?.input['TableName']).toBe('cache-table');
    expect(String(sent[0]?.input['FilterExpression'])).toContain('contains(PK, :id0)');
    expect(sent[1]?.input['ExclusiveStartKey']).toEqual({ PK: 'x', SK: 'y' });
  });

  it('does not match an identifier that is only a substring of a segment', async () => {
    const longer = `${U1}0`;
    const { client } = recorder([
      {
        Items: [
          { PK: `RATELIMIT#join#${longer}`, SK: 'd' },
          { PK: `RATELIMIT#join#${U1}`, SK: 'd' },
        ],
      },
    ]);
    const keys = await createCacheStore(client, 't').findByIdentifiers([U1]);
    expect(keys).toEqual([{ pk: `RATELIMIT#join#${U1}`, sk: 'd' }]);
  });

  it('skips scan items that have no SK or no PK', async () => {
    const { client } = recorder([
      { Items: [{ PK: `RATELIMIT#join#${U1}` }, { SK: 'd' }, { PK: `RATELIMIT#join#${U1}`, SK: 'd' }] },
    ]);
    const keys = await createCacheStore(client, 't').findByIdentifiers([U1]);
    expect(keys).toEqual([{ pk: `RATELIMIT#join#${U1}`, sk: 'd' }]);
  });

  it('aborts before any scan when an identifier is empty or not a UUID', async () => {
    const { client, sent } = recorder([{}]);
    const store = createCacheStore(client, 't');
    await expect(store.findByIdentifiers([''])).rejects.toThrow(/empty/);
    await expect(store.findByIdentifiers([U1, 'sub-1'])).rejects.toThrow(/UUID/);
    expect(sent).toEqual([]);
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
