import { groupPantryItemsByCategory, pantryCategoryLabel } from '@/domain/pantryGrouping';
import type { PantryQueryResult } from '@/graphql/queries';

interface PantrySectionProps {
  items: PantryQueryResult['pantry'];
}

/**
 * D5's read-only Pantry section — `Query.pantry`'s items grouped by
 * category (`domain/pantryGrouping.ts`'s own stable order, mirroring the
 * known-category vocabulary `api/src/domain/pantryCategories.ts` and
 * `pantry_category.dart` already share). Its own independent empty state
 * (RED test 2) fires on an empty array, regardless of whether the menu or
 * shopping-list sections below have data of their own.
 */
export function PantrySection({ items }: PantrySectionProps) {
  if (items.length === 0) {
    return (
      <section aria-labelledby="pantry-heading">
        <h2 id="pantry-heading">Pantry</h2>
        <p data-testid="pantry-empty-state">No pantry items yet.</p>
      </section>
    );
  }

  const groups = groupPantryItemsByCategory(items);

  return (
    <section aria-labelledby="pantry-heading">
      <h2 id="pantry-heading">Pantry</h2>
      {groups.map((group) => (
        <div key={group.category} data-testid={`pantry-category-${group.category}`}>
          <h3>{pantryCategoryLabel(group.category)}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                {item.name} — {item.quantity} {item.unit}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
