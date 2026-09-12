'use client';

interface StepsEditorProps {
  steps: string[];
  onChange: (steps: string[]) => void;
}

const updateAt = (list: string[], index: number, value: string): string[] =>
  list.map((item, i) => (i === index ? value : item));

const removeAt = (list: string[], index: number): string[] => list.filter((_, i) => i !== index);

/** Ordered step list editor — each step a single text input, add/remove rows. */
export function StepsEditor({ steps, onChange }: StepsEditorProps) {
  return (
    <fieldset>
      <legend>Steps</legend>
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            <input
              aria-label={`Step ${index + 1}`}
              value={step}
              onChange={(e) => onChange(updateAt(steps, index, e.target.value))}
            />
            <button type="button" onClick={() => onChange(removeAt(steps, index))}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onChange([...steps, ''])}>
        Add step
      </button>
    </fieldset>
  );
}
