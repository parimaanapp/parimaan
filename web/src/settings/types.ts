import type { CuisineBias, CuisineTier1, DietaryTag, MealType } from './domain';

/** One meal type's slot counts — mirrors `mealStructureEntrySchema` in `api/src/validation/updateHouseholdSettings.ts`. */
export interface MealStructureEntry {
  carb: number;
  sabzi_dal: number;
  accompaniment: number;
}

/** Decoded shape of the `mealStructure` `AWSJSON` scalar (a JSON string on the wire both ways, per `api/src/mappers/household.ts`). */
export type MealStructureMap = Partial<Record<MealType, MealStructureEntry>>;

/** Decoded shape of the `cuisineTier2Weights` `AWSJSON` scalar. */
export type CuisineTier2WeightsMap = Record<string, CuisineBias>;

/**
 * The household settings shape this screen reads and writes, matching
 * `HouseholdSettings`/`HouseholdSettingsInput` in `shared/schema.graphql`
 * field-for-field. `mealStructure`/`cuisineTier2Weights` stay `string` here
 * (the real AWSJSON wire shape) — decoded to `MealStructureMap`/
 * `CuisineTier2WeightsMap` only inside the section components that edit them.
 */
export interface HouseholdSettingsData {
  mealsEnabled: MealType[];
  mealStructure: string;
  cuisineTier1: CuisineTier1[];
  cuisineTier2Weights: string;
  dietaryTags: DietaryTag[];
  allergens: string[];
  skipIngredients: string[];
}

/** A genuine partial patch — every field optional, never sent with the current value "for safety." */
export type HouseholdSettingsPatch = Partial<HouseholdSettingsData>;
