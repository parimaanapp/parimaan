import { describe, expect, it } from 'vitest';
import { assertUuidIdentifiers, isUuid } from './identifiers.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('isUuid', () => {
  it('accepts a full UUID, any case', () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID.toUpperCase())).toBe(true);
  });

  it('rejects empty, partial, padded and non-UUID strings', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('sub-1')).toBe(false);
    expect(isUuid(` ${UUID}`)).toBe(false);
    expect(isUuid(`${UUID}0`)).toBe(false);
    expect(isUuid(UUID.slice(1))).toBe(false);
  });
});

describe('assertUuidIdentifiers', () => {
  it('passes for UUIDs', () => {
    expect(() => assertUuidIdentifiers([{ kind: 'user id', value: UUID }])).not.toThrow();
  });

  it('aborts on an empty value, naming the kind but not echoing a long value', () => {
    expect(() => assertUuidIdentifiers([{ kind: 'cognito sub', value: '' }])).toThrow(
      /cognito sub.*empty/i,
    );
  });

  it('aborts on a non-UUID value', () => {
    expect(() => assertUuidIdentifiers([{ kind: 'household id', value: 'sub-1' }])).toThrow(
      /household id.*UUID/,
    );
  });
});
