import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadStaplesNoteFnName } from './staplesNoteInvoker.js';

describe('loadStaplesNoteFnName', () => {
  it('parses STAPLES_NOTE_FN_NAME from the given env', () => {
    expect(loadStaplesNoteFnName({ STAPLES_NOTE_FN_NAME: 'Parimaan-dev-Api-StaplesNoteFn' })).toBe(
      'Parimaan-dev-Api-StaplesNoteFn',
    );
  });

  it('throws when STAPLES_NOTE_FN_NAME is missing', () => {
    expect(() => loadStaplesNoteFnName({})).toThrow();
  });
});

describe('invokeStaplesNoteFn', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.STAPLES_NOTE_FN_NAME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('never throws when STAPLES_NOTE_FN_NAME is unset — swallows and logs instead (D2\'s own "no synchronous caller left" requirement)', async () => {
    const { invokeStaplesNoteFn } = await import('./staplesNoteInvoker.js');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(invokeStaplesNoteFn({ listId: 'list-1', householdId: 'household-1' })).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
