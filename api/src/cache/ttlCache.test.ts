import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttlCache.js';

describe('TtlCache', () => {
  it('returns a value that was just set', () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('returns undefined for a key that was never set', () => {
    const cache = new TtlCache<string, number>(1000);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('returns undefined once the TTL has elapsed, without needing a call in between', () => {
    let now = 0;
    const cache = new TtlCache<string, number>(1000, () => now);
    cache.set('a', 1);
    now += 999;
    expect(cache.get('a')).toBe(1);
    now += 2; // now 1001ms after set — past the 1000ms TTL
    expect(cache.get('a')).toBeUndefined();
  });

  it('a set entry is gone immediately once its own expiry instant is reached, not merely close to it', () => {
    let now = 0;
    const cache = new TtlCache<string, number>(1000, () => now);
    cache.set('a', 1);
    now = 1000; // exactly at expiry, not past it
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete() removes a still-live entry', () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('delete() on a missing key is a harmless no-op', () => {
    const cache = new TtlCache<string, number>(1000);
    expect(() => cache.delete('missing')).not.toThrow();
  });

  it('clear() removes every entry', () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('re-setting an existing key resets its own expiry, not the original one', () => {
    let now = 0;
    const cache = new TtlCache<string, number>(1000, () => now);
    cache.set('a', 1);
    now = 900;
    cache.set('a', 2); // refreshed at 900ms — now expires at 1900ms, not 1000ms
    now = 1500;
    expect(cache.get('a')).toBe(2);
  });

  it('distinct keys never collide', () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBe(2);
  });
});
