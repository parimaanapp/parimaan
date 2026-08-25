import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  generateInviteCode,
} from './inviteCode.js';

describe('INVITE_CODE_ALPHABET', () => {
  it('is 31 characters (uppercase letters + digits, minus 0/O/1/I/L)', () => {
    expect(INVITE_CODE_ALPHABET.length).toBe(31);
  });

  it('excludes ambiguous characters 0, O, 1, I, L', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });
});

describe('generateInviteCode', () => {
  it('always produces a code of INVITE_CODE_LENGTH characters', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(INVITE_CODE_LENGTH).toBe(6);
  });

  it('only uses characters from INVITE_CODE_ALPHABET', () => {
    const code = generateInviteCode();
    for (const char of code) {
      expect(INVITE_CODE_ALPHABET).toContain(char);
    }
  });

  it('never contains excluded ambiguous characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
        expect(code).not.toContain(ambiguous);
      }
    }
  });

  it('is deterministic given a stubbed sequential RNG', () => {
    const values = [0, 1, 2, 3, 4, 5];
    let index = 0;
    const stubRandomInt = (_min: number, _max: number): number => {
      const value = values[index];
      index += 1;
      if (value === undefined) {
        throw new Error('ran out of stubbed values');
      }
      return value;
    };
    const code = generateInviteCode(stubRandomInt);
    expect(code).toBe(INVITE_CODE_ALPHABET.slice(0, 6));
  });

  it('calls the injected RNG with rejection-sampling bounds [0, alphabet.length)', () => {
    const calls: Array<[number, number]> = [];
    const stubRandomInt = (min: number, max: number): number => {
      calls.push([min, max]);
      return 0;
    };
    generateInviteCode(stubRandomInt);
    expect(calls).toHaveLength(INVITE_CODE_LENGTH);
    for (const call of calls) {
      expect(call).toEqual([0, INVITE_CODE_ALPHABET.length]);
    }
  });

  // 2,000 draws against the 31^6 (~887M) code space keeps the expected
  // collision count (birthday approximation: n^2 / 2N) around 0.0023 — a
  // false failure roughly once per ~440 runs. The original 10,000-draw
  // version put that figure around 5.6%, which is what was actually firing
  // in CI: two different real runs failed on two different flaky tests in
  // this file's neighbourhood, and this was the reproducible one. Fewer
  // draws is the fix, not a larger alphabet or a fixed seed — the alphabet
  // and length are locked product decisions, and the point of a *real* RNG
  // smoke test is to catch an actual bug in `generateInviteCode`, which a
  // seeded fake can't do.
  it('produces no duplicates across 2,000 generations (smoke test)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      seen.add(generateInviteCode());
    }
    expect(seen.size).toBe(2_000);
  });
});
