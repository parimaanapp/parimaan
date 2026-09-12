import { groupShoppingListItemsByCategory, shoppingListCategoryLabel } from '@/domain/shoppingListGrouping';
import type { ShoppingListQueryResult } from '@/graphql/queries';

interface ShoppingListSectionProps {
  shoppingList: ShoppingListQueryResult['shoppingList'];
}

/**
 * D5's read-only Shopping list section — D4's new `Query.shoppingList`,
 * grouped by category (`domain/shoppingListGrouping.ts`'s own port of
 * `shopping_list_category_order.dart`). `shoppingList: null` is D4's own
 * documented "no list generated yet" case, not an error — rendered here as
 * this section's own independent empty state (RED test 4), distinct from
 * "no menu yet" (the menu section's empty state) even though a missing menu
 * implies a missing list too (`loadDashboardData` never even issues this
 * query in that case).
 */
export function ShoppingListSection({ shoppingList }: ShoppingListSectionProps) {
  if (shoppingList === null || shoppingList.items.length === 0) {
    return (
      <section aria-labelledby="shopping-list-heading">
        <h2 id="shopping-list-heading">Shopping list</h2>
        <p data-testid="shopping-list-empty-state">No shopping list yet.</p>
      </section>
    );
  }

  const groups = groupShoppingListItemsByCategory(shoppingList.items);

  return (
    <section aria-labelledby="shopping-list-heading">
      <h2 id="shopping-list-heading">Shopping list</h2>
      {groups.map((group) => (
        <div key={group.category} data-testid={`shopping-list-category-${group.category}`}>
          <h3>{shoppingListCategoryLabel(group.category)}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id} data-purchased={item.purchased}>
                {item.name}
                {item.quantity != null ? ` — ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
