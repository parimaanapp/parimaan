import type { MealStructureEntry } from './householdDefaults.js';
import { getMealSlotCap, isMealSlotEnabled, SINGLE_ITEM_MEAL_SLOTS } from './mealStructure.js';

/**
 * `lunch`/`dinner`'s three per-role slots, in the order
 * `mobile/lib/features/menu/domain/meal_slot_plan.dart`'s own
 * `MealSlot.values` iterates them — not load-bearing for correctness (every
 * role is still enumerated exactly once per its `mealStructure` count
 * regardless of order), but keeping the two lists in the same order is one
 * less thing to double-check when comparing this file against its client
 * mirror. Typed against `keyof MealStructureEntry` (not a bare string-literal
 * tuple) so a future rename/addition to `MealStructureEntry`
 * (`householdDefaults.ts`) fails this file's own compile, rather than
 * silently going unenumerated.
 */
const LUNCH_DINNER_ROLES: readonly (keyof MealStructureEntry)[] = ['carb', 'sabzi_dal', 'accompaniment'];

/**
 * `breakfast`/`snacks` are role-agnostic single-recipe meals
 * (`mealStructure.ts`'s own `SINGLE_ITEM_MEAL_SLOTS`) — the recipe row
 * itself still carries a `role` (`breakfast` or `snack`), so a candidate
 * pool for these slots is keyed on this fixed mapping, mirroring
 * `meal_slot_plan.dart`'s `_singleItemSlot` fallback-role choice exactly.
 */
const SINGLE_ITEM_SLOT_ROLE: Readonly<Record<string, string>> = {
  breakfast: 'breakfast',
  snacks: 'snack',
};

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;

export interface RotationHouseholdSettings {
  mealsEnabled: readonly string[];
  mealStructure: Record<string, unknown>;
}

export interface ExistingMenuItemSlot {
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
}

export interface EmptySlot {
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
}

/**
 * The server-side twin of `plannedSlotsForDay` (`meal_slot_plan.dart`),
 * across all 7 days rather than one — every empty slot `autoFillWeek`
 * could propose a recipe for, honoring `mealsEnabled` and `mealStructure`
 * exactly the way `addMenuItem`'s own cap enforcement does. Consumes
 * `getMealSlotCap`/`SINGLE_ITEM_MEAL_SLOTS` rather than re-deriving caps
 * (E2E_MVP_PLAN.md §16.5.1) — this is a THIRD implementation of the same
 * cap rule (server single-add, server batch-fill, client grid), and the
 * only way to keep it from drifting is a single cap authority with
 * multiple callers, not three independent readings of `mealStructure`.
 *
 * A day with existing items reduces (never negates) the count for its own
 * `(mealSlot, slotRole)` triple — this function only ever describes
 * SLOTS STILL OPEN, not the household's full configured capacity.
 */
export const enumerateEmptySlots = (
  settings: RotationHouseholdSettings,
  existingItems: readonly ExistingMenuItemSlot[],
): EmptySlot[] => {
  const slots: EmptySlot[] = [];

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    for (const mealSlot of MEAL_TYPES) {
      if (!isMealSlotEnabled(settings.mealsEnabled, mealSlot)) {
        continue;
      }

      if (SINGLE_ITEM_MEAL_SLOTS.includes(mealSlot)) {
        const slotRole = SINGLE_ITEM_SLOT_ROLE[mealSlot];
        if (slotRole === undefined) {
          // Fails loudly rather than silently pushing an undefined role —
          // `SINGLE_ITEM_MEAL_SLOTS` (mealStructure.ts) and
          // `SINGLE_ITEM_SLOT_ROLE` (this file) must stay in lockstep;
          // this is the one place that mirroring isn't enforced by a
          // shared import, so a drift here must not fail silently the way
          // a cast would have let it.
          throw new Error(`enumerateEmptySlots: no fixed role mapping for single-item slot "${mealSlot}".`);
        }
        const alreadyFilled = existingItems.some(
          (item) => item.dayOfWeek === dayOfWeek && item.mealSlot === mealSlot,
        );
        if (!alreadyFilled) {
          slots.push({ dayOfWeek, mealSlot, slotRole });
        }
        continue;
      }

      for (const slotRole of LUNCH_DINNER_ROLES) {
        const cap = getMealSlotCap(settings.mealStructure, mealSlot, slotRole);
        const filledCount = existingItems.filter(
          (item) => item.dayOfWeek === dayOfWeek && item.mealSlot === mealSlot && item.slotRole === slotRole,
        ).length;
        for (let i = filledCount; i < cap; i += 1) {
          slots.push({ dayOfWeek, mealSlot, slotRole });
        }
      }
    }
  }

  return slots;
};

/** §16.2.8 D1 — a soft, tiered recency penalty, never a hard exclusion. Re-tunable without touching any structure. */
export const RECENCY_WINDOW_WEEKS = 3;

/** The heaviest recency penalty multiplier — applied at `weeksAgo === 1` (last week). */
const RECENCY_MULTIPLIER_AT_ONE_WEEK = 0.2;
/** The lightest recency penalty multiplier — applied at `weeksAgo === RECENCY_WINDOW_WEEKS`. */
const RECENCY_MULTIPLIER_AT_WINDOW_EDGE = 0.8;

/**
 * A formula, not a fixed per-`weeksAgo` lookup table — a table keyed by
 * literal week numbers would silently FAIL OPEN (no penalty at all, via
 * `?? 1`) for any `weeksAgo` inside the window that has no matching entry,
 * the exact opposite of `getMealSlotCap`'s own fail-closed convention this
 * file otherwise follows. Deriving the multiplier from `RECENCY_WINDOW_WEEKS`
 * directly means there is no second constant that can drift out of sync
 * with it — re-tuning the window alone keeps this correct. Linearly
 * interpolates from the heaviest penalty at `weeksAgo === 1` to the
 * lightest at `weeksAgo === RECENCY_WINDOW_WEEKS`; the caller is
 * responsible for range-checking `weeksAgo` first (`scoreCandidate` does).
 */
const recencyMultiplier = (weeksAgo: number): number => {
  if (RECENCY_WINDOW_WEEKS <= 1) {
    return RECENCY_MULTIPLIER_AT_ONE_WEEK;
  }
  const progress = (weeksAgo - 1) / (RECENCY_WINDOW_WEEKS - 1);
  return RECENCY_MULTIPLIER_AT_ONE_WEEK + progress * (RECENCY_MULTIPLIER_AT_WINDOW_EDGE - RECENCY_MULTIPLIER_AT_ONE_WEEK);
};

/** §16.2.8 D2 — cuisine bias multipliers. Never zero: a bias must never become a hard filter (PRD §7.3). */
const TIER1_MATCH_MULTIPLIER = 2.0;
const TIER2_WEIGHT_MULTIPLIER: Readonly<Record<string, number>> = {
  more: 2.0,
  normal: 1.0,
  less: 0.4,
};

export interface RotationRecipeCandidate {
  recipeId: string;
  cuisineTier1: string | null;
  cuisineTier2: string | null;
}

/**
 * Combines D1 (recency) and D2 (cuisine bias) into one positive weight —
 * never 0, so a candidate is never truly unpickable, only more or less
 * likely. `weeksAgo` is the fewest weeks since this recipe was last
 * planned within `RECENCY_WINDOW_WEEKS`, or `null` if it wasn't planned in
 * that window at all (no penalty).
 */
export const scoreCandidate = (
  candidate: RotationRecipeCandidate,
  cuisineTier1: readonly string[],
  cuisineTier2Weights: Record<string, unknown>,
  weeksAgo: number | null,
): number => {
  let weight = 1.0;

  if (candidate.cuisineTier1 !== null && cuisineTier1.includes(candidate.cuisineTier1)) {
    weight *= TIER1_MATCH_MULTIPLIER;
  }

  if (candidate.cuisineTier2 !== null) {
    const configured = cuisineTier2Weights[candidate.cuisineTier2];
    const multiplier = typeof configured === 'string' ? TIER2_WEIGHT_MULTIPLIER[configured] : undefined;
    weight *= multiplier ?? TIER2_WEIGHT_MULTIPLIER.normal!;
  }

  if (weeksAgo !== null && weeksAgo >= 1 && weeksAgo <= RECENCY_WINDOW_WEEKS) {
    weight *= recencyMultiplier(weeksAgo);
  }

  return weight;
};

export interface WeightedCandidate {
  recipeId: string;
  weight: number;
}

export interface ProposedPick {
  dayOfWeek: number;
  mealSlot: string;
  slotRole: string;
  recipeId: string;
}

/**
 * Injected RNG (`() => number` in `[0, 1)`, `Math.random`'s own contract)
 * so every test is deterministic while production stays genuinely random —
 * the seam E2E_MVP_PLAN.md §16.5.4 names as the whole answer to "a
 * random-ish feature is hard to tell apart from a broken one."
 */
export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/**
 * Picks one recipe per empty slot from its role's weighted candidate pool,
 * skipping (never throwing on) a slot whose role has no candidates left —
 * §16's D6, best-effort partial fill is the whole point. Enforces one hard
 * rule beyond the weighting: the same recipe is never placed twice within
 * one meal instance (`dayOfWeek` + `mealSlot`) — already-chosen recipes for
 * that meal are excluded from the pool for every subsequent slot in it,
 * regardless of role, so a `carb` slot and a `sabzi_dal` slot in the same
 * lunch can still never both land the same recipe.
 */
export const pickForSlots = (
  slots: readonly EmptySlot[],
  candidatesByRole: ReadonlyMap<string, readonly WeightedCandidate[]>,
  rng: Rng,
): ProposedPick[] => {
  const picks: ProposedPick[] = [];
  const usedInMeal = new Map<string, Set<string>>();

  for (const slot of slots) {
    const mealKey = `${slot.dayOfWeek}:${slot.mealSlot}`;
    const excluded = usedInMeal.get(mealKey) ?? new Set<string>();

    const pool = (candidatesByRole.get(slot.slotRole) ?? []).filter(
      (candidate) => !excluded.has(candidate.recipeId),
    );
    if (pool.length === 0) {
      continue;
    }

    const chosen = weightedPick(pool, rng);
    picks.push({ ...slot, recipeId: chosen.recipeId });

    excluded.add(chosen.recipeId);
    usedInMeal.set(mealKey, excluded);
  }

  return picks;
};

/** Precondition: `pool` is non-empty — enforced by `pickForSlots`'s own guard before this is ever called, not re-checked here. */
const weightedPick = (pool: readonly WeightedCandidate[], rng: Rng): WeightedCandidate => {
  const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
  let remaining = rng() * total;
  for (const candidate of pool) {
    remaining -= candidate.weight;
    if (remaining <= 0) {
      return candidate;
    }
  }
  // Floating-point rounding can leave `remaining` fractionally above 0
  // after the loop; the last candidate is the correct pick in that case.
  return pool[pool.length - 1]!;
};
