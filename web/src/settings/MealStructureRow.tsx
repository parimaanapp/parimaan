'use client';

import { MEAL_TYPE_LABELS, type MealType } from './domain';
import type { MealStructureEntry } from './types';

interface MealStructureRowProps {
  mealType: MealType;
  enabled: boolean;
  entry: MealStructureEntry;
  onToggle: (enabled: boolean) => void;
  onEntryChange: (entry: MealStructureEntry) => void;
}

const SLOT_FIELDS: Array<keyof MealStructureEntry> = ['carb', 'sabzi_dal', 'accompaniment'];
const SLOT_LABELS: Record<keyof MealStructureEntry, string> = {
  carb: 'Carb',
  sabzi_dal: 'Sabzi/Dal',
  accompaniment: 'Accompaniment',
};

/** One meal type's row: an enabled checkbox plus its three slot-count steppers, disabled while the meal itself is off. */
export function MealStructureRow({ mealType, enabled, entry, onToggle, onEntryChange }: MealStructureRowProps) {
  const setSlot = (field: keyof MealStructureEntry, value: number) =>
    onEntryChange({ ...entry, [field]: Math.max(0, Math.min(10, value)) });

  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
          aria-label={`Enable ${MEAL_TYPE_LABELS[mealType]}`}
        />
        {MEAL_TYPE_LABELS[mealType]}
      </label>
      {SLOT_FIELDS.map((field) => (
        <label key={field}>
          {SLOT_LABELS[field]}
          <input
            type="number"
            min={0}
            max={10}
            value={entry[field]}
            disabled={!enabled}
            onChange={(event) => setSlot(field, Number(event.target.value))}
            aria-label={`${MEAL_TYPE_LABELS[mealType]} ${SLOT_LABELS[field]} count`}
          />
        </label>
      ))}
    </div>
  );
}
