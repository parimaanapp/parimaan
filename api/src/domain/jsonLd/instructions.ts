import { MAX_STEPS } from '../../validation/recipeShared.js';

/**
 * Caps total stack-pops, independently of `MAX_STEPS`. `MAX_STEPS` alone
 * only stops the walk once `steps.length` reaches it — an adversarial tree
 * of many `HowToSection` nodes that never yield step text (empty
 * `itemListElement`, no `text`/`name`) would never advance `steps.length`,
 * so the walk would still visit every node in the tree with no bound of
 * its own (flagged by `typescript-reviewer`: the doc comment below used to
 * claim `MAX_STEPS` capped this case too, which it did not). Set well above
 * the depth of this module's own adversarial fixture (20,000 levels,
 * `_adversarial-deep-nesting.html`) so a legitimately-deep-but-real tree
 * still reaches its content — the bound exists for a tree that never
 * yields anything, not to reject depth on its own.
 */
const MAX_NODES_VISITED = 100_000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Pushes `nested`'s entries onto `stack` in reverse, so `stack.pop()` continues to visit them in document order — the same reversed-push trick the outer walk itself uses. */
const pushReversed = (stack: unknown[], nested: unknown[]): void => {
  for (let i = nested.length - 1; i >= 0; i -= 1) {
    stack.push(nested[i]);
  }
};

/** One stack-pop's worth of work: a leaf step's text, or `null` when `item` is a section to expand (already pushed onto `stack`) or has no usable text. */
const visitInstructionItem = (item: unknown, stack: unknown[]): string | null => {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (!isPlainObject(item)) {
    return null;
  }
  const nested = item['itemListElement'];
  if (Array.isArray(nested)) {
    pushReversed(stack, nested);
    return null;
  }
  const text = item['text'] ?? item['name'];
  return typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
};

/**
 * Flattens `recipeInstructions` into an ordered list of step strings.
 * Handles every shape S1's 20 real fixtures produced: a plain string, an
 * array of strings, an array of `HowToStep` objects, and an array of
 * `HowToSection` objects (each holding its own `itemListElement` array of
 * steps — sections flatten in document order, losing only their heading,
 * which `RecipeDraft.steps` has nowhere to carry).
 *
 * Deliberately an explicit stack, not recursion — a `HowToSection` tree can
 * be adversarially deep (S4's own named RED test, E2E_MVP_PLAN.md §13.3),
 * and only an iterative walk is immune to a call-stack blowout regardless
 * of nesting depth. Two independent bounds stop the walk itself, not just
 * shape the returned array: `MAX_STEPS` (reused from `createRecipe`'s own
 * bound, §12.3 S3) once enough real steps have been found, and
 * `MAX_NODES_VISITED` for a tree that never yields any (see its own doc
 * comment) — either alone would leave the other case unbounded.
 */
export const flattenInstructions = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? [] : [trimmed];
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: string[] = [];
  const stack: unknown[] = [...value].reverse();
  let nodesVisited = 0;
  while (stack.length > 0 && steps.length < MAX_STEPS && nodesVisited < MAX_NODES_VISITED) {
    nodesVisited += 1;
    const step = visitInstructionItem(stack.pop(), stack);
    if (step !== null) {
      steps.push(step);
    }
  }
  return steps;
};
