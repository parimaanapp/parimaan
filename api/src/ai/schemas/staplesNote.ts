import { z } from 'zod';

/**
 * D3's own locked number (E2E_MVP_PLAN.md §23.2.3): generous enough for the
 * PRD's own multi-item example ("You might want to check: Kitchen King
 * Masala, jeera, hing") with headroom, tight enough that a runaway
 * generation can't produce an essay-length "note" a shopping-list UI has
 * no room for.
 */
export const MAX_STAPLES_NOTE_LENGTH = 200;

/**
 * The structural shape `invokeModel` validates `staplesNoteFn`'s Gemini
 * response against — a single string field, so there is no enum-leniency
 * concern here at all (`invokeModel.ts`'s own doc comment: leniency is
 * only ever needed for closed-enum-shaped fields, and this schema has
 * none). Strict on structure/bounds per the asymmetric-leniency pattern
 * `recipeDraft.ts` established: a `note` over `MAX_STAPLES_NOTE_LENGTH`
 * fails the whole parse and triggers `invokeModel`'s built-in
 * reinforcement retry, exactly like any other bounds violation.
 *
 * `.trim()` runs before the length check (matching `recipeDraft.ts`'s own
 * `z.string().trim().max(...)` ingredient fields) so incidental
 * leading/trailing whitespace the model emits is never what tips a
 * response over the cap.
 *
 * **An empty string is explicitly valid, not an error** (D3, §23.2.3): a
 * week with no recipes planned yet, or recipes with no meaningfully
 * "stockable" staples, may legitimately produce an empty note. There is
 * deliberately no `.min(1)` here — `staplesNoteFn` (S3, not built by this
 * slice) treats an empty `note` as a successful, non-alarming result
 * (writing `null` to `ai_staples_note` per D3's own wording), never as a
 * reason to retry or throw. Only a genuine transport/parse/validation
 * failure (any of `invokeModel`'s six taxonomy codes) is a real error.
 */
export const staplesNoteOutputSchema = z.object({
  note: z.string().trim().max(MAX_STAPLES_NOTE_LENGTH),
});

export type StaplesNoteOutput = z.infer<typeof staplesNoteOutputSchema>;
