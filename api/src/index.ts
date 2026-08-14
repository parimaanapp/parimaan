/**
 * @parimaan/api — AppSync Lambda resolvers (Node 20 + TypeScript).
 * See SYSTEM_DESIGN.md §5 (resolvers) and §12.2 (layout).
 *
 * Resolvers land in src/resolvers/, pure domain logic in src/domain/
 * (zero mocks, >=80% coverage per E2E_MVP_PLAN.md §8).
 *
 * Populated in W1. This placeholder exists so `tsc --noEmit` has an input file.
 */

export const API_PACKAGE_NAME = '@parimaan/api' as const;
