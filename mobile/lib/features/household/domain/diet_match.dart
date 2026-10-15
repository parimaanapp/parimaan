/// Dart port of `api/src/domain/dietMatch.ts` (E2E_MVP_PLAN.md section 32.3),
/// the single source of truth for "may this household be served this recipe?".
/// Both implementations are pinned to `shared/fixtures/dietMatch-cases.json`,
/// so they cannot drift.
///
/// Tags are the wire values (`veg`, `non_veg`, `vegan`, `eggetarian`, `jain`,
/// `gluten_free`, `dairy_free`).
///
/// - STYLES (how the household eats) combine as a UNION, and a style also
///   admits the stricter recipes: [_styleExpansion].
/// - MODIFIERS (`gluten_free`, `dairy_free`) must ALL be present on the
///   recipe. A vegan recipe also satisfies `dairy_free`.
/// - A household with no styles applies no style restriction.
library;

const List<String> dietStyles = <String>[
  'veg',
  'non_veg',
  'vegan',
  'eggetarian',
  'jain',
];

const List<String> dietModifiers = <String>['gluten_free', 'dairy_free'];

const Map<String, List<String>> _styleExpansion = <String, List<String>>{
  'veg': <String>['veg', 'vegan', 'jain'],
  'vegan': <String>['vegan'],
  'jain': <String>['jain'],
  'eggetarian': <String>['eggetarian', 'veg', 'vegan', 'jain'],
  'non_veg': <String>['non_veg', 'eggetarian', 'veg', 'vegan', 'jain'],
};

/// The recipe's tags plus the modifier they imply (vegan implies dairy_free).
Set<String> _effectiveRecipeTags(List<String> recipeTags) => <String>{
  ...recipeTags,
  if (recipeTags.contains('vegan')) 'dairy_free',
};

List<String> _householdStyles(List<String> householdTags) =>
    householdTags.where(dietStyles.contains).toSet().toList(growable: false);

List<String> _householdModifiers(List<String> householdTags) => householdTags
    .where(dietModifiers.contains)
    .toSet()
    .toList(growable: false);

bool _styleSatisfied(Set<String> tags, List<String> styles) =>
    styles.isEmpty ||
    styles.any(
      (String style) => _styleExpansion[style]!.any(tags.contains),
    );

/// Whether a recipe carrying [recipeTags] may be served to a household whose
/// settings carry [householdTags].
bool isRecipeEligible(List<String> recipeTags, List<String> householdTags) {
  final Set<String> tags = _effectiveRecipeTags(recipeTags);
  return _styleSatisfied(tags, _householdStyles(householdTags)) &&
      _householdModifiers(householdTags).every(tags.contains);
}

/// The household tags a recipe fails to satisfy, in the household's own order
/// (for the picker's "Doesn't match" warning). Empty when the recipe is
/// eligible. When no style is satisfied, every household style is reported;
/// unknown household tags are ignored.
List<String> unmetHouseholdTags(
  List<String> recipeTags,
  List<String> householdTags,
) {
  final Set<String> tags = _effectiveRecipeTags(recipeTags);
  final List<String> styles = _householdStyles(householdTags);
  final bool styleOk = _styleSatisfied(tags, styles);
  return householdTags
      .where(
        (String tag) =>
            (dietStyles.contains(tag) && !styleOk) ||
            (dietModifiers.contains(tag) && !tags.contains(tag)),
      )
      .toList(growable: false);
}
