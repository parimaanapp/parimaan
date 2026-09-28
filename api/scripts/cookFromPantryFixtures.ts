import type { CookPromptContext } from '../prompts/cookFromPantry.js';

/**
 * W21 S1 (D12) — six realistic household pantries for the measurement spike.
 * Synthetic but written the way real households type: brand names, Hindi and
 * English names for the same thing, a leftover or two. They are the test bed
 * for grounding (does the model reuse pantry names?) and for the preference
 * rules, not a benchmark of Indian cooking.
 */
export interface CookSpikeFixture {
  readonly id: string;
  readonly context: Omit<CookPromptContext, 'vibe'>;
}

const NO_WEIGHTS = {} as const;

export const COOK_SPIKE_FIXTURES: readonly CookSpikeFixture[] = [
  {
    id: 'north-indian-typical',
    context: {
      pantry: [
        'Toor Dal', 'Moong Dal', 'Masoor Dal', 'Chana Dal', 'Rajma', 'Kabuli Chana', 'Basmati Rice', 'Atta', 'Besan', 'Suji',
        'Poha', 'Onion', 'Potato', 'Tomato', 'Ginger', 'Garlic', 'Green Chilli', 'Cauliflower', 'Peas', 'Spinach', 'Paneer',
        'Curd', 'Milk', 'Ghee', 'Amul Butter', 'Mustard Oil', 'Jeera', 'Haldi', 'Red Chilli Powder', 'Dhania Powder',
        'Garam Masala', 'Hing', 'Kasuri Methi', 'Sugar', 'Salt',
      ],
      dietaryTags: ['veg'],
      skipIngredients: [],
      allergens: [],
      cuisineTier1: ['north_indian'],
      cuisineTier2Weights: NO_WEIGHTS,
    },
  },
  {
    id: 'south-indian-typical',
    context: {
      pantry: [
        'Idli Rice', 'Raw Rice', 'Urad Dal', 'Toor Dal', 'Rava', 'Poha', 'Curd', 'Coconut', 'Tamarind', 'Onion', 'Tomato', 'Drumstick',
        'Brinjal', 'Raw Banana', 'Curry Leaves', 'Green Chilli', 'Mustard Seeds', 'Coconut Oil', 'Sambar Powder', 'Rasam Powder',
        'Red Chilli', 'Turmeric', 'Hing', 'Jaggery', 'Salt',
      ],
      dietaryTags: ['veg'],
      skipIngredients: [],
      allergens: [],
      cuisineTier1: ['south_indian'],
      cuisineTier2Weights: { kerala: 'more' },
    },
  },
  {
    id: 'sparse-five',
    context: {
      pantry: ['Basmati Rice', 'Onion', 'Potato', 'Salt', 'Turmeric'],
      dietaryTags: [],
      skipIngredients: [],
      allergens: [],
      cuisineTier1: [],
      cuisineTier2Weights: NO_WEIGHTS,
    },
  },
  {
    id: 'spice-heavy',
    context: {
      pantry: [
        'Jeera', 'Rai', 'Methi Dana', 'Ajwain', 'Saunf', 'Kalonji', 'Dhania Seeds', 'Black Pepper', 'Cardamom', 'Cloves', 'Cinnamon',
        'Bay Leaf', 'Star Anise', 'Haldi', 'Kashmiri Chilli Powder', 'Chaat Masala', 'Amchur', 'Garam Masala', 'Pav Bhaji Masala',
        'Kitchen King Masala', 'Onion', 'Rice', 'Ghee',
      ],
      dietaryTags: ['veg'],
      skipIngredients: [],
      allergens: [],
      cuisineTier1: ['north_indian'],
      cuisineTier2Weights: NO_WEIGHTS,
    },
  },
  {
    id: 'fridge-leftovers',
    context: {
      pantry: ['Eggs', 'Bread', 'Milk', 'Paneer', 'Capsicum', 'Cabbage', 'Carrot', 'Coriander', 'Lemon', 'Curd', 'Leftover Rice', 'Butter', 'Onion', 'Tomato', 'Tomato Ketchup', 'Maggi Noodles', 'Cheese Slices', 'Salt'],
      dietaryTags: ['eggetarian'],
      skipIngredients: [],
      allergens: [],
      cuisineTier1: ['indo_chinese'],
      cuisineTier2Weights: NO_WEIGHTS,
    },
  },
  {
    // Deliberately adversarial: peanuts are in the pantry AND on the skip and allergen lists, and onion/garlic/potato are skipped
    // while Jain also forbids root vegetables, so a model that just cooks from the pantry list breaks the household's rules.
    id: 'jain-with-skips',
    context: {
      pantry: [
        'Toor Dal', 'Moong Dal', 'Chana Dal', 'Basmati Rice', 'Atta', 'Besan', 'Tomato', 'Cauliflower', 'Peas', 'Cabbage', 'Capsicum',
        'Lauki', 'Paneer', 'Curd', 'Ghee', 'Jeera', 'Haldi', 'Hing', 'Red Chilli Powder', 'Garam Masala', 'Peanuts', 'Salt',
      ],
      dietaryTags: ['jain', 'veg'],
      skipIngredients: ['onion', 'garlic', 'potato', 'peanuts'],
      allergens: ['peanuts'],
      cuisineTier1: ['north_indian'],
      cuisineTier2Weights: { gujarati: 'more' },
    },
  },
];
