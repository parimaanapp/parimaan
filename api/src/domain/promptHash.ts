import { createHash } from 'node:crypto';

export interface PromptHashInput {
  readonly model: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly prompt: string;
}

/**
 * W21 D5 — the cache key's content half. The rendered prompt already covers
 * the pantry, the preferences and the vibe; the model, temperature and output
 * limit are folded in too because each of them changes the answer without
 * changing a byte of the prompt (the S1 security review's point). Same
 * 16-hex-character shape as W17 D6's staples-note key.
 *
 * The inputs are JSON-encoded as a tuple, not joined with a delimiter, so a
 * value can never borrow text from its neighbour ("3|x" + 2 versus "|x" + 23).
 */
export const computePromptHash = ({ model, temperature, maxOutputTokens, prompt }: PromptHashInput): string =>
  createHash('sha256').update(JSON.stringify([model, temperature, maxOutputTokens, prompt])).digest('hex').slice(0, 16);

/**
 * A stable id for one suggestion within one prompt's answer (W21 S3, for S4's UI
 * state: the expanded card, the "saved" marker, the detail route). Derived from
 * the prompt hash and the suggestion's identity in the model's output, so it is
 * the same on a cache hit and never depends on how grounding re-ranks the list.
 */
export const computeSuggestionId = (promptHash: string, suggestionKey: string): string =>
  createHash('sha256').update(JSON.stringify([promptHash, suggestionKey])).digest('hex').slice(0, 16);
