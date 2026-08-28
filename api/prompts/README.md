# Prompts

Every AI feature's prompt lives in its own `*.ts` file here, per
`SYSTEM_DESIGN.md` §8.3: versioned, code-reviewed, unit-testable, never
inline in a resolver.

Convention, established in W7 S2 (`E2E_MVP_PLAN.md` §13.3 S2) for
`parseFreeformRecipe`'s prompt (S3) to follow, and every AI feature after it:

- One file per prompt, e.g. `parseFreeformRecipe.ts`.
- Export a `PROMPT_VERSION` numeric constant alongside the prompt-building
  function — bump it whenever the prompt text changes. Logged (server-side
  only, never at a level that persists household content — SD §8.3)
  alongside every `invokeModel` call, so a prompt regression is traceable to
  the exact version that produced it.
- The prompt-building function takes only the data it needs (e.g. the raw
  pasted text) and returns a plain string — no side effects, no I/O, unit
  tested directly without a network call.

Empty otherwise until S3 adds the first real prompt.
