import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so the hash ignores property insertion order. */
const canonicalize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Stable sha256 of a listing. Arrays are hashed in the order the listing
 * builder produced them (which sorts everything deterministically), except
 * `emails`, which is sorted here so a caller's CLI ordering cannot matter.
 */
export const hashListing = (listing: { readonly emails: readonly string[] }): string => {
  const normalised = { ...listing, emails: [...listing.emails].sort() };
  return createHash('sha256').update(canonicalize(normalised)).digest('hex');
};
