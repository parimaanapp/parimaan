import type { PoolClient } from 'pg';

/** How many households `userId` belongs to (as primary or member). */
export const countMembershipsForUser = async (
  client: PoolClient,
  userId: string,
): Promise<number> => {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM household_memberships WHERE user_id = $1`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
};
