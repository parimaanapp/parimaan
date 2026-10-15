import { describe, expect, it } from 'vitest';
import { canonicaliseUnit } from './units.js';

describe('canonicaliseUnit', () => {
  it.each([
    ['g', 'g'], ['gm', 'g'], ['gms', 'g'], ['gram', 'g'], ['grams', 'g'], ['grammes', 'g'], ['G', 'g'], ['g.', 'g'],
    ['kg', 'kg'], ['kgs', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
    ['ml', 'ml'], ['mls', 'ml'], ['millilitre', 'ml'], ['milliliters', 'ml'],
    ['l', 'l'], ['ltr', 'l'], ['litre', 'l'], ['liters', 'l'], ['Litres', 'l'],
    ['tsp', 'tsp'], ['tsps', 'tsp'], ['tsp.', 'tsp'], ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
    ['tbsp', 'tbsp'], ['tbsps', 'tbsp'], ['tbs', 'tbsp'], ['tablespoon', 'tbsp'], ['Tablespoons', 'tbsp'],
    ['cup', 'cup'], ['cups', 'cup'], ['Cup', 'cup'],
    ['piece', 'piece'], ['pieces', 'piece'], ['pc', 'piece'], ['pcs', 'piece'], ['clove', 'clove'], ['cloves', 'clove'],
    ['can', 'can'], ['tins', 'can'], ['lb', 'lb'], ['lbs', 'lb'], ['pounds', 'lb'], ['oz', 'oz'], ['ounces', 'oz'],
    ['bunch', 'bunch'], ['bunches', 'bunch'],
    ['pinch', 'pinch'], ['pinches', 'pinch'],
    ['packet', 'packet'], ['packets', 'packet'],
    ['jar', 'jar'], ['bottle', 'bottle'], ['bottles', 'bottle'],
  ])('maps %j to %j', (input, expected) => {
    expect(canonicaliseUnit(input)).toBe(expected);
  });

  it.each([['chicken'], ['salt'], ['no'], ['no.'], ['nos'], [''], ['   '], ['xyzzy']])('returns null for non-unit %j', (input) => {
    expect(canonicaliseUnit(input)).toBeNull();
  });
});
