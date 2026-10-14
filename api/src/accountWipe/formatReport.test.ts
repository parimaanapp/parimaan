import { describe, expect, it } from 'vitest';
import { formatReport } from './formatReport.js';
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
});
