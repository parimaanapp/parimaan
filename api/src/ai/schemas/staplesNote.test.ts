import { describe, expect, it } from 'vitest';
import { MAX_STAPLES_NOTE_LENGTH, staplesNoteOutputSchema } from './staplesNote.js';

describe('staplesNoteOutputSchema', () => {
  it('accepts a well-formed note under 200 characters', () => {
    const result = staplesNoteOutputSchema.safeParse({
      note: 'You might want to check: Kitchen King Masala, jeera, hing.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('You might want to check: Kitchen King Masala, jeera, hing.');
    }
  });

  it('rejects a note over 200 characters', () => {
    const tooLong = 'a'.repeat(MAX_STAPLES_NOTE_LENGTH + 1);
    const result = staplesNoteOutputSchema.safeParse({ note: tooLong });
    expect(result.success).toBe(false);
  });

  it('accepts a note at exactly the 200-character cap', () => {
    const atCap = 'a'.repeat(MAX_STAPLES_NOTE_LENGTH);
    const result = staplesNoteOutputSchema.safeParse({ note: atCap });
    expect(result.success).toBe(true);
  });

  it('accepts an empty-string note as valid — a plan with no meaningfully stockable staples is a legitimate outcome, not an error', () => {
    const result = staplesNoteOutputSchema.safeParse({ note: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('');
    }
  });

  it('accepts a near-empty (whitespace-only) note, trimmed down to empty', () => {
    const result = staplesNoteOutputSchema.safeParse({ note: '   ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('');
    }
  });

  it('rejects a missing note field entirely — structural validation still fails hard', () => {
    const result = staplesNoteOutputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-string note', () => {
    const result = staplesNoteOutputSchema.safeParse({ note: 123 });
    expect(result.success).toBe(false);
  });
});
