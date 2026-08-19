import type { Pool } from 'pg';
import type { CallerIdentity } from '../auth/identity.js';
import type { UserRow } from './userRepository.js';
import { upsertUserByCognitoSub } from './userRepository.js';

/**
 * Resolves (upserting on first login) the caller's `users` row from a plain
 * pooled client — never `withUserTransaction`, since `users` has no RLS
 * policy and a single upsert statement doesn't need a transaction. Shared
 * by every resolver in this slice (`me`, `userHouseholds`,
 * `createHousehold`), which all previously duplicated this identical
 * connect/upsert/release sequence.
 */
export const resolveCallerUser = async (pool: Pool, identity: CallerIdentity): Promise<UserRow> => {
  const client = await pool.connect();
  try {
    return await upsertUserByCognitoSub(client, identity);
  } finally {
    client.release();
  }
};
