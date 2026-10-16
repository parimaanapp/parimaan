import { describe, expect, it } from 'vitest';
import { formatQuantity } from '@/domain/formatQuantity';

describe('formatQuantity', () => {
  it('drops trailing zeros', () => {
    expect(formatQuantity(2)).toBe('2');
    expect(formatQuantity(2.0)).toBe('2');
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(100)).toBe('100');
  });

  it('caps at two decimals', () => {
    expect(formatQuantity(0.3333333333333333)).toBe('0.33');
    expect(formatQuantity(0.6666666666666666)).toBe('0.67');
  });

  it('shows tiny and negative-zero values as a plain 0', () => {
    expect(formatQuantity(0.001)).toBe('0');
    expect(formatQuantity(-0.001)).toBe('0');
  });
});
