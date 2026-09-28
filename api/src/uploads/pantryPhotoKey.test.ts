import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPantryPhotoKey, isOwnPantryPhotoKey } from './pantryPhotoKey.js';

const sub = '11111111-2222-3333-4444-555555555555';
const otherSub = '99999999-2222-3333-4444-555555555555';

describe('pantry photo keys (W20 D1: caller-scoped, so no DB membership check is needed)', () => {
  it('builds pantry-photos/{sub}/{uuid}.jpg', () => {
    const id = randomUUID();
    expect(buildPantryPhotoKey(sub, id)).toBe(`pantry-photos/${sub}/${id}.jpg`);
  });

  it('accepts a key the caller\'s own presign produced', () => {
    expect(isOwnPantryPhotoKey(sub, buildPantryPhotoKey(sub, randomUUID()))).toBe(true);
  });

  it("rejects another user's key — the whole ownership model rests on this", () => {
    expect(isOwnPantryPhotoKey(sub, buildPantryPhotoKey(otherSub, randomUUID()))).toBe(false);
  });

  it.each([
    ['path traversal', `pantry-photos/${sub}/../${otherSub}/${randomUUID()}.jpg`],
    ['a nested path', `pantry-photos/${sub}/x/${randomUUID()}.jpg`],
    ['another prefix', `exports/${sub}/${randomUUID()}.jpg`],
    ['a leading slash', `/pantry-photos/${sub}/${randomUUID()}.jpg`],
    ['a non-jpg extension', `pantry-photos/${sub}/${randomUUID()}.png`],
    ['a non-uuid object name', `pantry-photos/${sub}/receipt.jpg`],
    ['a trailing suffix', `pantry-photos/${sub}/${randomUUID()}.jpg/extra`],
    ['an empty key', ''],
    ['uppercase hex (never produced by the presign)', `pantry-photos/${sub}/${randomUUID().toUpperCase()}.jpg`],
  ])('rejects %s', (_label, key) => {
    expect(isOwnPantryPhotoKey(sub, key)).toBe(false);
  });

  it('rejects everything when the caller sub is not a UUID, instead of matching loosely', () => {
    expect(isOwnPantryPhotoKey('not-a-uuid', 'pantry-photos/not-a-uuid/' + randomUUID() + '.jpg')).toBe(false);
  });
});
