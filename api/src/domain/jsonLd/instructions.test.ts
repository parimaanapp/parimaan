import { describe, expect, it } from 'vitest';
import { flattenInstructions } from './instructions.js';

describe('flattenInstructions', () => {
  it('wraps a plain string as a single step', () => {
    expect(flattenInstructions('Prepare the ingredients')).toEqual(['Prepare the ingredients']);
  });

  it('returns an empty array for a blank string', () => {
    expect(flattenInstructions('   ')).toEqual([]);
  });

  it('accepts an array of plain strings', () => {
    expect(flattenInstructions(['Step one', 'Step two'])).toEqual(['Step one', 'Step two']);
  });

  it('extracts text from an array of HowToStep objects', () => {
    const steps = [
      { '@type': 'HowToStep', text: 'Chop the onions.' },
      { '@type': 'HowToStep', text: 'Fry until golden.' },
    ];
    expect(flattenInstructions(steps)).toEqual(['Chop the onions.', 'Fry until golden.']);
  });

  it('flattens a HowToSection tree in document order, dropping only the section heading', () => {
    const sections = [
      {
        '@type': 'HowToSection',
        name: 'To saute & puree',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Pour oil to a pan.' },
          { '@type': 'HowToStep', text: 'Add tomatoes and cook.' },
        ],
      },
      {
        '@type': 'HowToSection',
        name: 'To finish',
        itemListElement: [{ '@type': 'HowToStep', text: 'Blend to a smooth puree.' }],
      },
    ];
    expect(flattenInstructions(sections)).toEqual(['Pour oil to a pan.', 'Add tomatoes and cook.', 'Blend to a smooth puree.']);
  });

  it('returns an empty array for neither a string nor an array', () => {
    expect(flattenInstructions(undefined)).toEqual([]);
    expect(flattenInstructions(null)).toEqual([]);
    expect(flattenInstructions(42)).toEqual([]);
  });

  it('skips array entries with no usable text rather than throwing', () => {
    expect(flattenInstructions([{ '@type': 'HowToStep' }, 'Real step'])).toEqual(['Real step']);
  });

  it('stops within a bounded number of visited nodes on a wide tree of sections that never yield step text', () => {
    const emptySections = Array.from({ length: 150_000 }, (_, i) => ({
      '@type': 'HowToSection',
      name: `Empty section ${i}`,
      itemListElement: [],
    }));
    const start = Date.now();
    expect(flattenInstructions(emptySections)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('does not blow the stack on an adversarially deep HowToSection nesting', () => {
    let deepest: unknown = { '@type': 'HowToStep', text: 'Bottom step.' };
    for (let i = 0; i < 20_000; i += 1) {
      deepest = { '@type': 'HowToSection', name: `Section ${i}`, itemListElement: [deepest] };
    }
    expect(() => flattenInstructions([deepest])).not.toThrow();
    expect(flattenInstructions([deepest])).toEqual(['Bottom step.']);
  });
});
