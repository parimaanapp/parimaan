import { z } from 'zod';

/**
 * The single shared schema for every `householdId: ID!` mutation argument.
 * GraphQL's `ID` scalar is just a string on the wire — it carries no format
 * guarantee at all — so every household-scoped resolver has to prove the
 * value is a real UUID before it reaches a `WHERE id = $1`, where a
 * non-UUID would otherwise surface as a raw `pg` `22P02` invalid-input-syntax
 * error rather than a typed `ValidationError`.
 *
 * Deliberately one exported constant rather than an inline
 * `z.string().uuid(...)` per validation module: the message is client-facing
 * and asserted on in tests, so drift between resolvers would be a real,
 * silent inconsistency in the API's error surface.
 */
export const householdIdSchema = z.string().uuid('householdId must be a valid UUID');
