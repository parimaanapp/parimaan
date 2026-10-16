import 'package:flutter/foundation.dart';

/// One canonical ingredient from the global catalog (`Query.searchIngredients`,
/// `docs/catalog/README.md`). GraphQL-free, like every domain type.
///
/// [allowedUnits] is in preference order and always contains [defaultUnit].
@immutable
class CatalogIngredient {
  const CatalogIngredient({
    required this.id,
    required this.name,
    required this.category,
    required this.categoryLabel,
    required this.allowedUnits,
    required this.defaultUnit,
    this.aliases = const <String>[],
  });

  final String id;

  /// Canonical English name (`Toor Dal`).
  final String name;

  /// Stored category value (`dal`, `meat_fish`) — a pantry category too.
  final String category;

  /// Approved UI copy for [category].
  final String categoryLabel;

  final List<String> allowedUnits;
  final String defaultUnit;
  final List<String> aliases;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CatalogIngredient &&
          other.id == id &&
          other.name == name &&
          other.category == category &&
          other.categoryLabel == categoryLabel &&
          other.defaultUnit == defaultUnit &&
          listEquals(other.allowedUnits, allowedUnits) &&
          listEquals(other.aliases, aliases);

  @override
  int get hashCode => Object.hash(
    id,
    name,
    category,
    categoryLabel,
    defaultUnit,
    Object.hashAll(allowedUnits),
    Object.hashAll(aliases),
  );
}

String _fold(String value) {
  final String lower = value.trim().toLowerCase();
  return lower.length > 3 && lower.endsWith('s')
      ? lower.substring(0, lower.length - 1)
      : lower;
}

/// The alias that carried [query]'s match, or `null` when the canonical name
/// matches (nothing to hint) or nothing matches. Lets the picker say
/// "also known as arhar" for `arh` -> Toor Dal.
String? matchedAlias(CatalogIngredient ingredient, String query) {
  final String needle = _fold(query);
  if (needle.isEmpty) {
    return null;
  }
  if (_fold(ingredient.name).contains(needle)) {
    return null;
  }
  for (final String alias in ingredient.aliases) {
    if (_fold(alias).contains(needle)) {
      return alias;
    }
  }
  return null;
}

/// [selected] while [text] still names it, otherwise `null`. A row that was
/// picked from the catalog and then edited by hand is free text again.
CatalogIngredient? selectionFor(CatalogIngredient? selected, String text) {
  if (selected == null) {
    return null;
  }
  return selected.name.toLowerCase() == text.trim().toLowerCase()
      ? selected
      : null;
}

/// Units to offer for [ingredient]: its allowed units (default first), or
/// [fallback] for free text. [current] is appended when it is not listed, so
/// an existing row's out-of-list unit never disappears from the chips.
List<String> unitsForIngredient(
  CatalogIngredient? ingredient, {
  required List<String> fallback,
  String? current,
}) {
  final List<String> base =
      ingredient == null || ingredient.allowedUnits.isEmpty
      ? fallback
      : ingredient.allowedUnits;
  final String trimmed = (current ?? '').trim();
  if (trimmed.isEmpty ||
      base.any((String u) => u.toLowerCase() == trimmed.toLowerCase())) {
    return base;
  }
  return <String>[...base, trimmed];
}

/// The unit a row should hold right after [ingredient] is picked: the current
/// unit when the ingredient allows it, otherwise the catalog default.
String unitAfterSelection(CatalogIngredient ingredient, String currentUnit) {
  final String trimmed = currentUnit.trim().toLowerCase();
  final bool allowed = ingredient.allowedUnits.any(
    (String u) => u.toLowerCase() == trimmed,
  );
  return allowed && trimmed.isNotEmpty
      ? currentUnit.trim()
      : ingredient.defaultUnit;
}
