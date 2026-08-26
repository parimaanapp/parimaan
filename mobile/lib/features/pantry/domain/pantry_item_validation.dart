/// Fast client-side feedback mirroring `api/src/validation/addPantryItem.ts`
/// (and `updatePantryItem.ts`, whose per-field bounds are identical) — same
/// "this is not a gate, the server remains the authority" rule as
/// `domain/household_name.dart`. Bounds and messages are hand-ported, not
/// shared, from the Zod schemas; drift is caught by this file's own tests
/// mirroring the server's Vitest case table, not by any shared code.
library;

const int maxPantryItemNameLength = 120;
const int maxPantryItemUnitLength = 20;
const int maxPantryItemCategoryLength = 40;

final RegExp _controlCharacters = RegExp(r'[\x00-\x1F\x7F]');
final RegExp _awsDatePattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');

String? validatePantryItemName(String name) {
  final String trimmed = name.trim();
  if (trimmed.isEmpty) {
    return 'name must not be empty';
  }
  if (trimmed.length > maxPantryItemNameLength) {
    return 'name must be at most $maxPantryItemNameLength characters';
  }
  if (_controlCharacters.hasMatch(trimmed)) {
    return 'name must not contain control characters';
  }
  return null;
}

/// `quantity` arrives as a `double` already — a text field's raw string is
/// parsed by the caller before this runs, so "not a number" is a parse
/// failure the caller handles separately, not a case this validates.
String? validatePantryItemQuantity(double quantity) {
  if (quantity.isNaN) {
    return 'quantity must be a number';
  }
  if (quantity < 0) {
    return 'quantity must not be negative';
  }
  return null;
}

String? validatePantryItemUnit(String unit) {
  final String trimmed = unit.trim();
  if (trimmed.isEmpty) {
    return 'unit must not be empty';
  }
  if (trimmed.length > maxPantryItemUnitLength) {
    return 'unit must be at most $maxPantryItemUnitLength characters';
  }
  return null;
}

/// `category` is optional — `null`/empty means "not set", not a validation
/// failure.
String? validatePantryItemCategory(String? category) {
  if (category == null) {
    return null;
  }
  final String trimmed = category.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.length > maxPantryItemCategoryLength) {
    return 'category must be at most $maxPantryItemCategoryLength characters';
  }
  return null;
}

/// `AWSDate` (`YYYY-MM-DD`). `null`/empty means "no expiry set".
String? validatePantryItemExpiryDate(String? expiryDate) {
  if (expiryDate == null || expiryDate.trim().isEmpty) {
    return null;
  }
  if (!_awsDatePattern.hasMatch(expiryDate.trim())) {
    return 'expiryDate must be in YYYY-MM-DD format';
  }
  return null;
}

/// `null` means "no threshold set".
String? validatePantryItemLowThreshold(double? lowThreshold) {
  if (lowThreshold == null) {
    return null;
  }
  if (lowThreshold.isNaN) {
    return 'lowThreshold must be a number';
  }
  if (lowThreshold < 0) {
    return 'lowThreshold must not be negative';
  }
  return null;
}
