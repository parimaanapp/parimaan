import { describe, expect, it } from 'vitest';
import { hashListing } from './listingHash.js';
import { emptyListing } from './testing/fakes.js';

describe('hashListing', () => {
  it('is stable for identical content and independent of email order', () => {
    const a = emptyListing(['b@x.test', 'a@x.test']);
    const b = emptyListing(['a@x.test', 'b@x.test']);
    expect(hashListing(a)).toBe(hashListing(b));
    expect(hashListing(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any listed item changes', () => {
    const a = emptyListing(['a@x.test']);
    const b = { ...a, objects: [{ bucket: 'b', key: 'k' }] };
    expect(hashListing(a)).not.toBe(hashListing(b));
  });

  it('is independent of object property insertion order', () => {
    const a = { ...emptyListing(['a@x.test']), objects: [{ bucket: 'b', key: 'k' }] };
    const b = { ...emptyListing(['a@x.test']), objects: [{ key: 'k', bucket: 'b' }] };
    expect(hashListing(a)).toBe(hashListing(b));
  });
});
