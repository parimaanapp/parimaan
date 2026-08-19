import { describe, expect, it } from 'vitest';
import { isUniqueViolationOnConstraint } from './pgErrors.js';

describe('isUniqueViolationOnConstraint', () => {
  it('recognizes a matching unique-violation error', () => {
    const error = { code: '23505', constraint: 'users_email_key' };
    expect(isUniqueViolationOnConstraint(error, 'users_email_key')).toBe(true);
  });

  it('rejects a unique-violation on a different constraint', () => {
    const error = { code: '23505', constraint: 'households_invite_code_key' };
    expect(isUniqueViolationOnConstraint(error, 'users_email_key')).toBe(false);
  });

  it('rejects a non-unique-violation error code', () => {
    const error = { code: '23503', constraint: 'users_email_key' };
    expect(isUniqueViolationOnConstraint(error, 'users_email_key')).toBe(false);
  });

  it('rejects null, undefined, and non-object values', () => {
    expect(isUniqueViolationOnConstraint(null, 'users_email_key')).toBe(false);
    expect(isUniqueViolationOnConstraint(undefined, 'users_email_key')).toBe(false);
    expect(isUniqueViolationOnConstraint('error', 'users_email_key')).toBe(false);
  });

  it('rejects an object missing the code or constraint field', () => {
    expect(isUniqueViolationOnConstraint({ code: '23505' }, 'users_email_key')).toBe(false);
    expect(isUniqueViolationOnConstraint({ constraint: 'users_email_key' }, 'users_email_key')).toBe(
      false,
    );
  });
});
