import type { PantryItemRow } from '../repositories/pantryRepository.js';

export interface GraphQLPantryItem {
  id: string;
  householdId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  isStaple: boolean;
  /** `AWSDate` — see `shared/schema.graphql`'s `PantryItem.expiryDate` doc. */
  expiryDate: string | null;
  lowThreshold: number | null;
  addedBy: string;
  addedAt: string;
  updatedAt: string;
}

export const toGraphQLPantryItem = (row: PantryItemRow): GraphQLPantryItem => ({
  id: row.id,
  householdId: row.householdId,
  name: row.name,
  quantity: row.quantity,
  unit: row.unit,
  category: row.category,
  isStaple: row.isStaple,
  expiryDate: row.expiryDate,
  lowThreshold: row.lowThreshold,
  addedBy: row.addedBy,
  addedAt: row.addedAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
