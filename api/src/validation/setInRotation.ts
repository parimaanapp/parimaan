import { z } from 'zod';

/** Validates `Mutation.setInRotation`'s `{ id: ID!, inRotation: Boolean! }` arguments. */
export const setInRotationArgsSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  inRotation: z.boolean(),
});

export type SetInRotationArgs = z.infer<typeof setInRotationArgsSchema>;
