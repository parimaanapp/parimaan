import { describe, expect, it } from 'vitest';
import { buildCatalogIndex, resolveIngredient } from '../domain/ingredientCatalog.js';
import { catalogBundle } from './bundle.js';

// Guards the shopping-list dedupe merges recorded in docs/catalog/decisions.md:
// forms of one real-world item are a single catalog ingredient, so they cannot
// produce split shopping lines.
const index = buildCatalogIndex(catalogBundle.ingredients);
const ids = new Set(catalogBundle.ingredients.map((e) => e.id));

const MERGED: ReadonlyArray<readonly [removedId: string, name: string, keptId: string]> = [
  ['garlic_clove', 'Garlic (Clove)', 'garlic'],
  ['coconut_grated', 'Coconut (Grated)', 'coconut_fresh'],
  ['jaggery_powder', 'Jaggery Powder', 'jaggery'],
  ['roasted_peanuts', 'Roasted Peanuts', 'peanuts'],
  ['prawns_large', 'Prawns (Large)', 'prawns'],
  ['yellow_pumpkin', 'Yellow Pumpkin', 'pumpkin'],
  ['kasuri_methi_powder', 'Kasuri Methi Powder', 'dried_fenugreek_leaves'],
  ['roasted_cumin_powder', 'Roasted Cumin Powder', 'cumin_powder'],
  ['dry_ginger_powder', 'Dry Ginger Powder', 'ginger_powder'],
  ['mirch_banana_pepper', 'Mirch (Banana Pepper)', 'bhavnagri_chilli'],
  ['onion_red', 'Onion (Red)', 'onion'],
  ['tomato_desi', 'Tomato (Desi)', 'tomato'],
  ['mint_sprigs', 'Mint Sprigs', 'mint_leaves'],
  ['lemon_sweet', 'Lemon (Sweet)', 'sweet_lime'],
  ['cashew_pieces', 'Cashew Pieces', 'cashew_nuts'],
  ['black_mustard_seeds', 'Black Mustard Seeds', 'mustard_seeds'],
  ['brown_mustard_seeds', 'Brown Mustard Seeds', 'mustard_seeds'],
];

describe('catalog dedupe merges', () => {
  it.each(MERGED)('%s is gone and "%s" resolves to %s', (removedId, name, keptId) => {
    expect(ids.has(removedId)).toBe(false);
    expect(ids.has(keptId)).toBe(true);
    const result = resolveIngredient(name, index);
    expect(result).toMatchObject({ status: 'resolved', entry: { id: keptId } });
  });

  it('keeps genuinely different forms separate', () => {
    for (const id of ['garlic_paste', 'ginger_paste', 'ginger_garlic_paste', 'yellow_mustard_seeds', 'white_onion', 'tomato_roma', 'peanuts_skinless']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('treats a garlic piece as one clove, matching how the recipes write it', () => {
    const garlic = catalogBundle.ingredients.find((e) => e.id === 'garlic');
    expect(garlic?.pieceG).toBe(4);
  });
});
