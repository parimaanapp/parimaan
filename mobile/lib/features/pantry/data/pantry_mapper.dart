import '../../../shared/graphql/operations/__generated__/pantry_item_fields.data.gql.dart';
import '../domain/pantry_item.dart';

/// The boundary where Ferry / `built_value` types become the plain domain
/// type — same rule and precedent as `features/household/data/household_mapper.dart`.
///
/// Takes the **fragment** interface `GPantryItemFields`, not
/// `GPantryData_pantry` (`Query.pantry`'s own generated element type), since
/// `GPantryData_pantry implements GPantryItemFields` — the same "one mapper
/// for every operation that spreads this fragment" shape `household_mapper.dart`
/// establishes, ready for `addPantryItem`/`updatePantryItem`/`deletePantryItem`
/// (S6) to reuse without a second, hand-duplicated mapper.
PantryItem pantryItemFromGraphQL(GPantryItemFields data) => PantryItem(
  id: data.id,
  householdId: data.householdId,
  name: data.name,
  quantity: data.quantity,
  unit: data.unit,
  category: data.category,
  isStaple: data.isStaple,
  // `AWSDate` has no bespoke Dart type — Ferry boxes an unregistered custom
  // scalar in a generated wrapper (`GAWSDate`) carrying the raw wire string
  // as `.value`. See `pantry_item.dart`'s doc on why this stays a string.
  expiryDate: data.expiryDate?.value,
  lowThreshold: data.lowThreshold,
  addedBy: data.addedBy,
  addedAt: data.addedAt,
  updatedAt: data.updatedAt,
);
