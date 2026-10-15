import { describe, expect, it } from 'vitest';
import { formatFullListing, formatReport } from './formatReport.js';
import { hashListing } from './listingHash.js';
import { emptyDbListing, emptyListing } from './testing/fakes.js';

describe('formatReport', () => {
  const listing = {
    ...emptyListing(['a@x.test']),
    cognito: [{ username: 'Google_1', sub: 's1', email: 'a@x.test' }],
    db: {
      ...emptyDbListing(),
      users: [{ id: 'u1', cognitoSub: 's1', email: 'a@x.test' }],
      householdsDeleted: [{ id: 'h1', name: 'Home' }],
      householdsKept: [{ id: 'h2', name: 'Shared', remainingMemberCount: 2, wipedMemberCount: 1 }],
      tables: emptyDbListing().tables.map((t) =>
        t.table === 'pantry_items'
          ? { ...t, keys: ['1', '2', '3', '4', '5', '6', '7'] }
          : t,
      ),
    },
    objects: [{ bucket: 'up', key: 'pantry-photos/s1/a.jpg' }],
  };

  it('prints counts per table, at most 5 sample ids, and the hash', () => {
    const hash = hashListing(listing);
    const text = formatReport({ mode: 'dry-run', listing, hash });
    expect(text).toContain('pantry_items');
    expect(text).toMatch(/pantry_items\s+7/);
    expect(text).toContain('... and 2 more');
    expect(text).toContain(`Listing hash: ${hash}`);
    expect(text).toContain('--execute --confirm ' + hash);
    expect(text).toContain('KEPT');
    expect(text).toContain('Shared');
  });

  it('prints the verified target and any warnings, and they are in the hashed listing', () => {
    const withWarning = { ...listing, warnings: ['WARNING: db user u9 has no Cognito user'] };
    const text = formatReport({ mode: 'dry-run', listing: withWarning, hash: hashListing(withWarning) });
    expect(text).toContain('AWS account: 123456789012');
    expect(text).toContain('User pool: pool-1 (parimaan-dev)');
    expect(text).toContain('Database host: db.dev.rds.test');
    expect(text).toContain('WARNING: db user u9 has no Cognito user');
    expect(hashListing(withWarning)).not.toBe(hashListing(listing));
  });

  it('formatFullListing writes every key with the hash, untruncated', () => {
    const hash = hashListing(listing);
    const parsed = JSON.parse(formatFullListing({ mode: 'dry-run', listing, hash })) as {
      hash: string;
      listing: typeof listing;
    };
    expect(parsed.hash).toBe(hash);
    const pantry = parsed.listing.db.tables.find((t) => t.table === 'pantry_items');
    expect(pantry?.keys).toHaveLength(7);
    expect(parsed.listing.target.accountId).toBe('123456789012');
  });
});
