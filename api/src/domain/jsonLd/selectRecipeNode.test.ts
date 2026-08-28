import { describe, expect, it } from 'vitest';
import { selectRecipeNode } from './selectRecipeNode.js';

describe('selectRecipeNode', () => {
  it('returns null for an empty block list', () => {
    expect(selectRecipeNode([])).toBeNull();
  });

  it('returns null when no block has a Recipe-typed node', () => {
    expect(selectRecipeNode([{ '@type': 'Article' }, { '@type': 'WebPage' }])).toBeNull();
  });

  it('selects a bare top-level Recipe node', () => {
    const node = { '@type': 'Recipe', name: 'Test' };
    expect(selectRecipeNode([node])).toBe(node);
  });

  it('selects a Recipe node among five other node types inside an @graph wrapper', () => {
    const recipeNode = { '@type': 'Recipe', name: 'Target' };
    const block = {
      '@graph': [
        { '@type': 'Organization' },
        { '@type': 'WebSite' },
        { '@type': 'Person' },
        { '@type': 'BreadcrumbList' },
        recipeNode,
        { '@type': 'ImageObject' },
      ],
    };
    expect(selectRecipeNode([block])).toBe(recipeNode);
  });

  it('accepts @type as an array containing Recipe', () => {
    const node = { '@type': ['Recipe', 'NewsArticle'], name: 'Test' };
    expect(selectRecipeNode([node])).toBe(node);
  });

  it('accepts a top-level array of nodes (no @graph wrapper)', () => {
    const recipeNode = { '@type': 'Recipe', name: 'Target' };
    expect(selectRecipeNode([[{ '@type': 'Organization' }, recipeNode]])).toBe(recipeNode);
  });

  it('falls through to a later block when an earlier one has no Recipe node', () => {
    const recipeNode = { '@type': 'Recipe', name: 'Target' };
    expect(selectRecipeNode([{ '@type': 'Article' }, recipeNode])).toBe(recipeNode);
  });
});
