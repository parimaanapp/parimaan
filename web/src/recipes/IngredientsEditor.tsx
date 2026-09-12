'use client';

import type { RecipeIngredientInput } from './types';

interface IngredientsEditorProps {
  ingredients: RecipeIngredientInput[];
  onChange: (ingredients: RecipeIngredientInput[]) => void;
}

const BLANK_INGREDIENT: RecipeIngredientInput = {
  name: '',
  quantity: null,
  unit: null,
  category: null,
  notes: null,
  isStaple: false,
};

const updateAt = <T,>(list: T[], index: number, value: T): T[] =>
  list.map((item, i) => (i === index ? value : item));

const removeAt = <T,>(list: T[], index: number): T[] => list.filter((_, i) => i !== index);

/** Ingredient list editor — add/remove/edit rows, each a flat set of text inputs matching `RecipeIngredientInput`. */
export function IngredientsEditor({ ingredients, onChange }: IngredientsEditorProps) {
  return (
    <fieldset>
      <legend>Ingredients</legend>
      <ul>
        {ingredients.map((ingredient, index) => (
          <li key={index}>
            <input
              aria-label={`Ingredient ${index + 1} name`}
              value={ingredient.name}
              onChange={(e) => onChange(updateAt(ingredients, index, { ...ingredient, name: e.target.value }))}
            />
            <input
              aria-label={`Ingredient ${index + 1} quantity`}
              type="number"
              value={ingredient.quantity ?? ''}
              onChange={(e) =>
                onChange(
                  updateAt(ingredients, index, {
                    ...ingredient,
                    quantity: e.target.value === '' ? null : Number(e.target.value),
                  }),
                )
              }
            />
            <input
              aria-label={`Ingredient ${index + 1} unit`}
              value={ingredient.unit ?? ''}
              onChange={(e) => onChange(updateAt(ingredients, index, { ...ingredient, unit: e.target.value }))}
            />
            <button type="button" onClick={() => onChange(removeAt(ingredients, index))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onChange([...ingredients, { ...BLANK_INGREDIENT }])}>
        Add ingredient
      </button>
    </fieldset>
  );
}
