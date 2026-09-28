import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COOK_VIBE_VALUES } from '../../prompts/cookFromPantry.js';
import { cookFromPantryArgsSchema } from './cookFromPantry.js';

describe('cookFromPantryArgsSchema', () => {
  const householdId = randomUUID();

  it.each([...COOK_VIBE_VALUES])('accepts the vibe %s', (vibe) => {
    expect(cookFromPantryArgsSchema.parse({ householdId, vibe })).toEqual({ householdId, vibe });
  });

  it('reads an absent or null vibe as null ("any vibe"): a Ferry client sends an explicit null', () => {
    expect(cookFromPantryArgsSchema.parse({ householdId }).vibe).toBeNull();
    expect(cookFromPantryArgsSchema.parse({ householdId, vibe: null }).vibe).toBeNull();
  });

  it.each(['', 'QUICK', 'spicy', 'constructor', '__proto__', 'toString', 42, {}, ['quick']])('rejects the vibe %j (a closed set: no free text reaches the prompt)', (vibe) => {
    expect(cookFromPantryArgsSchema.safeParse({ householdId, vibe }).success).toBe(false);
  });

  it.each([undefined, null, '', 'not-a-uuid', 42])('rejects the householdId %j', (id) => {
    expect(cookFromPantryArgsSchema.safeParse({ householdId: id, vibe: 'quick' }).success).toBe(false);
  });

  it('lowercases the household id so one household is one cache key whatever case the client sends', () => {
    const upper = householdId.toUpperCase();
    expect(cookFromPantryArgsSchema.parse({ householdId: upper, vibe: 'quick' }).householdId).toBe(householdId.toLowerCase());
  });
});
