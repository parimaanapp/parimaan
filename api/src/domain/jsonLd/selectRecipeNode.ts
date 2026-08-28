const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasRecipeType = (node: Record<string, unknown>): boolean => {
  const type = node['@type'];
  if (typeof type === 'string') {
    return type === 'Recipe';
  }
  return Array.isArray(type) && type.includes('Recipe');
};

/** One JSON-LD block's candidate nodes: itself, its top-level array entries, or its `@graph` wrapper's entries — the three real shapes S1's 20 fixtures exhibited. */
const collectCandidateNodes = (block: unknown): Record<string, unknown>[] => {
  if (Array.isArray(block)) {
    return block.filter(isPlainObject);
  }
  if (!isPlainObject(block)) {
    return [];
  }
  const graph = block['@graph'];
  return Array.isArray(graph) ? graph.filter(isPlainObject) : [block];
};

/**
 * Finds the first `Recipe`-typed node across every extracted JSON-LD block,
 * walking `@graph` wrappers and accepting `@type` as either a bare string
 * or an array (`["Recipe","NewsArticle"]` — a real shape, not hypothetical:
 * WordPress SEO plugins commonly emit multiple types on one node). Returns
 * `null`, never throws, when no block contains one — a page with only
 * `Article`/`WebPage`/`BreadcrumbList` schema (four of S1's 20 fixtures) is
 * a normal, expected outcome, not an error.
 */
export const selectRecipeNode = (blocks: readonly unknown[]): Record<string, unknown> | null => {
  for (const block of blocks) {
    const match = collectCandidateNodes(block).find(hasRecipeType);
    if (match) {
      return match;
    }
  }
  return null;
};
