import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { deletePantryItemArgsSchema } from './deletePantryItem.js';

describe('deletePantryItemArgsSchema', () => {
  it('accepts a valid UUID id', () => {
    expect(deletePantryItemArgsSchema.safeParse({ id: randomUUID() }).success).toBe(true);
  });

  it('rejects a non-UUID id', () => {
    expect(deletePantryItemArgsSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(deletePantryItemArgsSchema.safeParse({}).success).toBe(false);
  });
});
