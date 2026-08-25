import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { updatePantryItemArgsSchema } from './updatePantryItem.js';

describe('updatePantryItemArgsSchema', () => {
  it('accepts a single-field patch', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({ id: randomUUID(), input: { quantity: 5 } }).success,
    ).toBe(true);
  });

  it('accepts a multi-field patch', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({
        id: randomUUID(),
        input: { quantity: 5, unit: 'kg', isStaple: true },
      }).success,
    ).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({ id: 'not-a-uuid', input: { quantity: 5 } }).success,
    ).toBe(false);
  });

  it('rejects an input with every field absent', () => {
    expect(updatePantryItemArgsSchema.safeParse({ id: randomUUID(), input: {} }).success).toBe(
      false,
    );
  });

  it('rejects an explicit null for a field', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({ id: randomUUID(), input: { quantity: null } })
        .success,
    ).toBe(false);
  });

  it('rejects a blank name if name is provided', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({ id: randomUUID(), input: { name: '' } }).success,
    ).toBe(false);
  });

  it('rejects a negative quantity if provided', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({ id: randomUUID(), input: { quantity: -1 } }).success,
    ).toBe(false);
  });

  it('rejects a malformed expiryDate if provided', () => {
    expect(
      updatePantryItemArgsSchema.safeParse({
        id: randomUUID(),
        input: { expiryDate: 'not-a-date' },
      }).success,
    ).toBe(false);
  });
});
