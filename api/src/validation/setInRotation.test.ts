import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setInRotationArgsSchema } from './setInRotation.js';

describe('setInRotationArgsSchema', () => {
  it('accepts a valid id and inRotation', () => {
    expect(setInRotationArgsSchema.safeParse({ id: randomUUID(), inRotation: true }).success).toBe(true);
    expect(setInRotationArgsSchema.safeParse({ id: randomUUID(), inRotation: false }).success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(
      setInRotationArgsSchema.safeParse({ id: 'not-a-uuid', inRotation: true }).success,
    ).toBe(false);
  });

  it('rejects a missing inRotation', () => {
    expect(setInRotationArgsSchema.safeParse({ id: randomUUID() }).success).toBe(false);
  });

  it('rejects a non-boolean inRotation', () => {
    expect(
      setInRotationArgsSchema.safeParse({ id: randomUUID(), inRotation: 'yes' }).success,
    ).toBe(false);
  });
});
