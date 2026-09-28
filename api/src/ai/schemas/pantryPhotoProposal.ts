import { z } from 'zod';
import { KNOWN_PANTRY_CATEGORIES, canonicalizePantryCategory } from '../../domain/pantryCategories.js';
import type { KnownPantryUnit } from '../../domain/pantryUnits.js';
import { canonicalizePantryUnit } from '../../domain/pantryUnits.js';
import { MAX_NAME_LENGTH } from '../../validation/addPantryItem.js';

/**
 * W20 S2 (`E2E_MVP_PLAN.md` §27.2 D3/D12) — the proposal schema, the
 * post-parse conversion, and the prompt for `analyzePantryPhoto`. Same
 * two-step split as `recipeDraft.ts`: `geminiPantryPhotoSchema` is the
 * **structural** shape `invokeModel` validates (a wrong-shaped response
 * earns a reinforcement retry), while every judgement about *content* —
 * unknown category, unknown unit, junk names — lives in
 * `toPantryPhotoProposals` and degrades one field or drops one item, never
 * fails the whole parse over an answer the model gave honestly.
 */

/** D3's product cap on proposals per photo. */
export const MAX_PROPOSED_ITEMS = 40;

/**
 * Units a photo can honestly support: counts of things you can see, plus
 * printed net weights/volumes. Deliberately a subset of `KNOWN_PANTRY_UNITS`
 * (no tsp/tbsp/cup — a photo cannot show a teaspoon); the `satisfies` makes
 * a rename in the app's list a compile error here rather than silent drift.
 * Matches the 9-unit vocabulary W20 S1 measured against (§27.6).
 */
export const PHOTO_UNITS = ['g', 'kg', 'ml', 'l', 'piece', 'packet', 'bunch', 'jar', 'bottle'] as const satisfies readonly KnownPantryUnit[];

const MAX_STRUCTURAL_NAME_LENGTH = 400;
/** A sanity ceiling, not a product rule: anything above is a hallucinated number, and proposing it would be worse than proposing none. */
const MAX_PLAUSIBLE_QUANTITY = 100_000;

const geminiPantryItemSchema = z.object({
  name: z.string().trim().min(1).max(MAX_STRUCTURAL_NAME_LENGTH),
  quantity: z.union([z.number(), z.string()]).nullish(),
  unit: z.string().trim().nullish(),
  category: z.string().trim().nullish(),
  confidence: z.string().trim().nullish(),
});

/** Defensive structural bound — twice the product cap, so a model slightly over 40 is truncated with a flag, while a runaway response is rejected outright. */
export const geminiPantryPhotoSchema = z.array(geminiPantryItemSchema).max(MAX_PROPOSED_ITEMS * 2);

export type GeminiPantryPhoto = z.infer<typeof geminiPantryPhotoSchema>;

export type ProposalConfidence = 'high' | 'medium' | 'low';

export interface PantryPhotoProposal {
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string;
  confidence: ProposalConfidence;
  /** Non-blocking notes (D3) — a proposal with warnings is still a usable proposal. */
  warnings: string[];
}

export interface PantryPhotoProposalResult {
  items: PantryPhotoProposal[];
  /** Items removed as empty, generic placeholders, or non-food (D12). Duplicates collapsed into one entry are not counted here. */
  droppedCount: number;
  /** True when more than `MAX_PROPOSED_ITEMS` survived filtering and the tail was cut. */
  truncated: boolean;
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

const GENERIC_EXACT_NAMES = new Set([
  'spice', 'spices', 'sauce', 'sauces', 'oil', 'oils', 'powder', 'powders', 'seeds', 'masala', 'food', 'item', 'items',
  'container', 'containers', 'jar', 'jars', 'bottle', 'bottles', 'packet', 'packets', 'snack', 'snacks', 'oil or sauce',
]);

/**
 * "Spice Mix Jar", "Storage Jar", "Snack Packet", "Spice Powder" — the
 * placeholder shapes W19's real output contained (13 of them). Requires a
 * *container-ish terminal word* after a generic prefix, so a real
 * "Chili Powder", "Mixed Dal" or "Tata Sampann Spices" is untouched.
 */
const GENERIC_PLACEHOLDER = /^(spice|spices|storage|mixed|unknown|assorted|snack|food|misc)\s+(?:\w+\s+)?(jar|jars|container|containers|packet|packets|bottle|bottles|pouch|box|item|items|mix|powder|powders)$/i;

/** Belt-and-braces behind the prompt's own food-only rule: W19's real output included aluminium foil and vitamins. */
const NON_FOOD = /\b(foil|cling\s?wrap|vitamins?|supplements?|tablets?|capsules?|detergent|dishwash|soap|tissues?|sponge)\b/i;

const cleanName = (raw: string): string => raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();

const isJunkName = (name: string): boolean =>
  name === '' || GENERIC_EXACT_NAMES.has(name.toLowerCase()) || GENERIC_PLACEHOLDER.test(name) || NON_FOOD.test(name);

const toQuantity = (raw: number | string | null | undefined): number | null => {
  const value = typeof raw === 'string' ? (/^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN) : raw;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_QUANTITY ? value : null;
};

const toConfidence = (raw: string | null | undefined): ProposalConfidence => {
  const lower = raw?.toLowerCase();
  return lower === 'high' || lower === 'medium' ? lower : 'low';
};

const toUnit = (raw: string | null | undefined): { unit: string | null; warnings: string[] } => {
  if (raw === null || raw === undefined || raw === '') return { unit: null, warnings: [] };
  const canonical = canonicalizePantryUnit(raw);
  return (PHOTO_UNITS as readonly string[]).includes(canonical)
    ? { unit: canonical, warnings: [] }
    : { unit: null, warnings: [`Unit "${raw}" wasn't recognised — please pick one.`] };
};

const toCategory = (raw: string | null | undefined): { category: string; warnings: string[] } => {
  if (raw === null || raw === undefined || raw === '') return { category: 'other', warnings: [] };
  const canonical = canonicalizePantryCategory(raw);
  return (KNOWN_PANTRY_CATEGORIES as readonly string[]).includes(canonical)
    ? { category: canonical, warnings: [] }
    : { category: 'other', warnings: [`Category "${raw}" wasn't recognised — set to Other.`] };
};

const toProposal = (raw: GeminiPantryPhoto[number], name: string): PantryPhotoProposal => {
  const unit = toUnit(raw.unit);
  const category = toCategory(raw.category);
  return {
    name,
    quantity: toQuantity(raw.quantity),
    unit: unit.unit,
    category: category.category,
    confidence: toConfidence(raw.confidence),
    warnings: [...unit.warnings, ...category.warnings],
  };
};

/** Same name seen twice in one photo: sum the counts when the units match, otherwise keep the first rather than guess across units (D12). */
const mergeDuplicate = (first: PantryPhotoProposal, later: PantryPhotoProposal): PantryPhotoProposal =>
  first.unit === later.unit && first.quantity !== null && later.quantity !== null
    ? { ...first, quantity: first.quantity + later.quantity }
    : first;

export const toPantryPhotoProposals = (raw: GeminiPantryPhoto): PantryPhotoProposalResult => {
  const byName = new Map<string, PantryPhotoProposal>();
  let droppedCount = 0;

  for (const entry of raw) {
    const name = cleanName(entry.name);
    if (isJunkName(name)) {
      droppedCount += 1;
      continue;
    }
    const key = name.toLowerCase();
    const proposal = toProposal(entry, name);
    const existing = byName.get(key);
    byName.set(key, existing === undefined ? proposal : mergeDuplicate(existing, proposal));
  }

  const all = [...byName.values()];
  return { items: all.slice(0, MAX_PROPOSED_ITEMS), droppedCount, truncated: all.length > MAX_PROPOSED_ITEMS };
};

/**
 * The prompt W20 S1 arrived at by measurement (§27.6), with its vocabulary
 * read from the app's own lists so the prompt cannot drift from what
 * `pantry_items` accepts. The two rules that carry the weight, both learned
 * from real output: identify from *visible contents* (a first, stricter
 * "skip if you can't tell" prompt cut recall 36%), and never emit
 * placeholder names (W19 emitted 13).
 */
export const buildPantryPhotoPrompt = (): string =>
  `You are looking at a photo of ONE shelf, drawer or compartment in an Indian home kitchen (pantry, fridge, or cabinet).
List the food and drink items you can actually identify. Return ONLY a JSON array (no prose, no markdown) of objects:
- "name": specific item name, using the brand/product name if a label is legible (e.g. "Toor Dal", "Amul Butter")
- "quantity": a whole number — how many containers/packets/bottles/bunches/pieces you can see of that item (default 1)
- "unit": exactly one of: ${PHOTO_UNITS.join(', ')}
- "category": exactly one of: ${KNOWN_PANTRY_CATEGORIES.join(', ')}
- "confidence": "high" if a label is legible, "medium" if identified from appearance, "low" if a guess
Rules: skip anything that is not food or drink (foil, utensils, containers, vitamins, cleaning items). You may identify an item from its visible contents when the container is clear or open (lentils, rice, whole spices, nuts, flours, pasta, snacks) — use confidence "medium" for those. Skip a container only if its contents are not visible or you genuinely cannot tell what they are, and never output generic placeholder names like "Spice Jar" or "Storage Jar". At most ${String(MAX_PROPOSED_ITEMS)} items. If nothing is identifiable, return [].`;
