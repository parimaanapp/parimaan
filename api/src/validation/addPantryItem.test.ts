import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { addPantryItemArgsSchema } from './addPantryItem.js';

const validArgs = (overrides: Record<string, unknown> = {}): unknown => ({
  householdId: randomUUID(),
  input: {
    name: 'Toor Dal',
    quantity: 2,
    unit: 'kg',
    ...overrides,
  },
});

describe('addPantryItemArgsSchema', () => {
  it('accepts a minimal valid input (name, quantity, unit only)', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs()).success).toBe(true);
  });

  it('accepts a fully populated input', () => {
    const result = addPantryItemArgsSchema.safeParse(
      validArgs({
        category: 'dal',
        isStaple: true,
        expiryDate: '2027-01-15',
        lowThreshold: 0.5,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a non-UUID householdId', () => {
    const args = validArgs();
    expect(
      addPantryItemArgsSchema.safeParse({ ...(args as object), householdId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ name: '' })).success).toBe(false);
    expect(addPantryItemArgsSchema.safeParse(validArgs({ name: '   ' })).success).toBe(false);
  });

  it('rejects a name over 120 characters', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ name: 'a'.repeat(121) })).success).toBe(false);
  });

  it('rejects a name containing a control character', () => {
    expect(
      addPantryItemArgsSchema.safeParse(validArgs({ name: `Bad${String.fromCharCode(9)}Name` })).success,
    ).toBe(false);
  });

  it('rejects a missing name', () => {
    const rest = { ...(validArgs() as { input: Record<string, unknown> }).input };
    delete rest.name;
    expect(
      addPantryItemArgsSchema.safeParse({ householdId: randomUUID(), input: rest }).success,
    ).toBe(false);
  });

  it('rejects a negative quantity', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ quantity: -1 })).success).toBe(false);
  });

  it('rejects a NaN quantity', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ quantity: Number.NaN })).success).toBe(false);
  });

  it('rejects a non-numeric quantity', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ quantity: 'two' })).success).toBe(false);
  });

  it('accepts a zero quantity', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ quantity: 0 })).success).toBe(true);
  });

  it('rejects a missing unit', () => {
    const rest = { ...(validArgs() as { input: Record<string, unknown> }).input };
    delete rest.unit;
    expect(
      addPantryItemArgsSchema.safeParse({ householdId: randomUUID(), input: rest }).success,
    ).toBe(false);
  });

  it('rejects a blank unit', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ unit: '' })).success).toBe(false);
  });

  it('rejects a unit over 20 characters', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ unit: 'a'.repeat(21) })).success).toBe(false);
  });

  it('rejects a category over 40 characters', () => {
    expect(
      addPantryItemArgsSchema.safeParse(validArgs({ category: 'a'.repeat(41) })).success,
    ).toBe(false);
  });

  it('accepts an unrecognised category — the column is open text, not a closed enum', () => {
    expect(
      addPantryItemArgsSchema.safeParse(validArgs({ category: 'festival snacks' })).success,
    ).toBe(true);
  });

  it('rejects a malformed expiryDate', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ expiryDate: '15-01-2027' })).success).toBe(
      false,
    );
    expect(addPantryItemArgsSchema.safeParse(validArgs({ expiryDate: 'not-a-date' })).success).toBe(
      false,
    );
  });

  it('accepts a well-formed expiryDate', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ expiryDate: '2027-01-15' })).success).toBe(
      true,
    );
  });

  it('rejects a negative lowThreshold', () => {
    expect(addPantryItemArgsSchema.safeParse(validArgs({ lowThreshold: -0.1 })).success).toBe(false);
  });

  it('rejects addedBy on the input even if a client sends one — it is not a schema field', () => {
    const result = addPantryItemArgsSchema.safeParse(
      validArgs({ addedBy: randomUUID() }),
    );
    // Zod strips unknown keys by default rather than rejecting them, so this
    // asserts the *value that survives parsing* has no addedBy — proving the
    // resolver can never read a client-supplied one off `parsedArgs.data`.
    expect(result.success).toBe(true);
    if (result.success) {
      expect('addedBy' in result.data.input).toBe(false);
    }
  });
});
