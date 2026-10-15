import { describe, expect, it } from 'vitest';
import { inferDietStyle, withInferredStyle } from './inferDietStyle.js';

describe('inferDietStyle', () => {
  it('veg when nothing meat, fish or egg is present', () => {
    expect(inferDietStyle('Dal Tadka', ['toor dal', 'ghee', 'cumin'])).toBe('veg');
    expect(inferDietStyle('Baingan Bharta', ['eggplant', 'butternut squash'])).toBe('veg');
  });

  it('eggetarian when egg but no meat or fish', () => {
    expect(inferDietStyle('Egg Curry', ['eggs', 'onion'])).toBe('eggetarian');
    expect(inferDietStyle('Mayo Sandwich', ['mayonnaise', 'bread'])).toBe('eggetarian');
  });

  it.each(['chicken', 'mutton', 'prawns', 'fish fillet', 'bacon'])('non_veg for %s', (name) => {
    expect(inferDietStyle('Dish', [name, 'onion'])).toBe('non_veg');
  });

  it('non_veg wins over egg', () => {
    expect(inferDietStyle('Egg and Chicken Roll', ['eggs', 'chicken'])).toBe('non_veg');
  });

  it('uses the title as well as ingredients', () => {
    expect(inferDietStyle('Chicken Biryani', ['rice'])).toBe('non_veg');
  });

  it('ignores harmless phrases', () => {
    expect(inferDietStyle('Eggless Cake', ['eggless cake batter', 'meatless mince'])).toBe('veg');
  });

  it('defaults to veg with no ingredients', () => {
    expect(inferDietStyle('Plain', [])).toBe('veg');
  });
});

describe('inferDietStyle — "-free" phrases never swallow real meat or egg (F2)', () => {
  it('Oil-free Chicken Curry is non_veg', () => {
    expect(inferDietStyle('Oil-free Chicken Curry', ['chicken', 'onion'])).toBe('non_veg');
    expect(inferDietStyle('Oil-free Chicken Curry', [])).toBe('non_veg');
  });

  it('"sugar-free" followed by a different ingredient does not hide it', () => {
    expect(inferDietStyle('Dessert', ['sugar-free', 'chicken breast'])).toBe('non_veg');
    expect(inferDietStyle('Sugar-free chicken breast', [])).toBe('non_veg');
  });

  it('gluten-free chicken is non_veg', () => {
    expect(inferDietStyle('Roast', ['gluten-free chicken'])).toBe('non_veg');
  });

  it('keeps the existing harmless replacements', () => {
    expect(inferDietStyle('Sandwich', ['egg-free mayo', 'meat-free mince', 'dairy-free butter'])).toBe('veg');
    expect(inferDietStyle('Wrap', ['gluten-free bread'])).toBe('veg');
  });
});

describe('inferDietStyle — Indian-language meat, fish and egg names (F3)', () => {
  it.each(['Dum Gosht', 'Kheema Pav', 'Murgh Makhani', 'Machli Fry', 'Meen Curry', 'Jhinga Masala', 'Maachh Jhol'])(
    '%s is non_veg from the title alone',
    (title) => {
      expect(inferDietStyle(title, [])).toBe('non_veg');
    },
  );

  it.each(['Anda Bhurji', 'Masala Omelette', 'Cheese Omelet'])('%s is eggetarian', (title) => {
    expect(inferDietStyle(title, [])).toBe('eggetarian');
  });

  it.each(['vegan mayo', 'vegan egg', 'egg replacer', 'eggless cake batter'])('%s does not count as egg', (name) => {
    expect(inferDietStyle('Salad', [name])).toBe('veg');
  });
});

describe('withInferredStyle', () => {
  it('leaves explicit style tags untouched, whatever the ingredients', () => {
    expect(withInferredStyle(['vegan'], 'Chicken', ['chicken'])).toEqual(['vegan']);
    expect(withInferredStyle(['non_veg', 'gluten_free'], 'Dal', ['dal'])).toEqual(['non_veg', 'gluten_free']);
  });

  it('appends an inferred style when only modifiers are present', () => {
    expect(withInferredStyle(['gluten_free'], 'Chicken Curry', ['chicken'])).toEqual(['gluten_free', 'non_veg']);
  });

  it('infers from null/undefined/empty tags', () => {
    expect(withInferredStyle(null, 'Dal', ['dal'])).toEqual(['veg']);
    expect(withInferredStyle(undefined, 'Omelette', ['egg'])).toEqual(['eggetarian']);
    expect(withInferredStyle([], 'Fish Fry', ['fish'])).toEqual(['non_veg']);
  });

  it('does not mutate its input', () => {
    const input = ['gluten_free'] as const;
    withInferredStyle(input, 'Dal', ['dal']);
    expect(input).toEqual(['gluten_free']);
  });
});
