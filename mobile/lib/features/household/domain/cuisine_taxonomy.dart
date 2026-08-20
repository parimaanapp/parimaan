/// The two-tier cuisine model from `docs/PRD.md` §7.3, typed.
///
/// Tier 1 is a schema enum (`CuisineTier1`); Tier 2 is **not** — it is a set
/// of free-form string keys inside the `cuisineTier2Weights` `AWSJSON` blob,
/// which the server bounds (≤20 keys, ≤40 characters each, values restricted
/// to `more`/`normal`/`less`) but does not enumerate. That asymmetry is why
/// Tier 1 lives in an `enum` here and Tier 2 lives in a `const` table.
library;

import 'dart:convert';

/// The five `CuisineTier1` values from `shared/schema.graphql`, in schema
/// order.
///
/// ## The missing region: East
///
/// Wireframe screen 2.4 draws **six** chips — North Indian, South Indian,
/// Pan-India, **East**, Indo-Chinese, Continental — and `docs/PRD.md` §7.3
/// names "East (separate top-level)" with Bengali / Odia / Assamese beneath
/// it. `shared/schema.graphql`'s `CuisineTier1` has only five values and
/// **`east` is not one of them**, so there is no value to send: an `east`
/// chip would be a control that fails server-side validation every time it is
/// used.
///
/// This omits the chip rather than inventing an enum value the API would
/// reject. Adding East is a schema + migration + resolver change, not a
/// mobile one — flagged in this slice's report rather than papered over here.
enum CuisineRegion {
  northIndian,
  southIndian,
  panIndia,
  indoChinese,
  continental;

  /// The exact `CuisineTier1` value name in `shared/schema.graphql`. Every one
  /// is snake_case, so none equals [name] — this getter owns the translation,
  /// the same way `household_mapper.dart` owns `past_due`/`pastDue`.
  String get wireValue => switch (this) {
    CuisineRegion.northIndian => 'north_indian',
    CuisineRegion.southIndian => 'south_indian',
    CuisineRegion.panIndia => 'pan_india',
    CuisineRegion.indoChinese => 'indo_chinese',
    CuisineRegion.continental => 'continental',
  };

  /// Wireframe screen 2.4 chip copy.
  String get displayLabel => switch (this) {
    CuisineRegion.northIndian => 'North Indian',
    CuisineRegion.southIndian => 'South Indian',
    CuisineRegion.panIndia => 'Pan-India',
    CuisineRegion.indoChinese => 'Indo-Chinese',
    CuisineRegion.continental => 'Continental',
  };
}

/// The first three chips are on by default, per wireframe screen 2.4.
const Set<CuisineRegion> defaultCuisineRegions = <CuisineRegion>{
  CuisineRegion.northIndian,
  CuisineRegion.southIndian,
  CuisineRegion.panIndia,
};

/// The three-way "more of / less of" bias from `docs/PRD.md` §7.3.
///
/// **The middle value is `normal` on the wire and "Same" in the UI.** The PRD
/// prose and the wireframe both say "same"; the server's Zod enum is
/// `['more', 'normal', 'less']` and rejects `same`. Both spellings are kept —
/// [wireValue] for the API, [displayLabel] for the screen — because dropping
/// either one loses information: sending "same" fails validation, and showing
/// "normal" to a user reads like a system state rather than a preference.
enum CuisineBias {
  less,
  normal,
  more;

  /// What the wizard starts every sub-cuisine at: no bias either way.
  static const CuisineBias defaultBias = CuisineBias.normal;

  /// The exact value the server's `CUISINE_TIER2_WEIGHT_VALUES` accepts.
  String get wireValue => name;

  /// Wireframe screen 2.5 segment copy. See the class doc for why `normal`
  /// reads as "Same".
  String get displayLabel => switch (this) {
    CuisineBias.less => 'Less',
    CuisineBias.normal => 'Same',
    CuisineBias.more => 'More',
  };
}

/// One Tier 2 sub-cuisine: the key persisted in `cuisineTier2Weights`, plus
/// the label shown beside its bias selector.
///
/// [key] is snake_case and stable — it is a **persisted map key**, not display
/// copy, so renaming a label must never rename a key (that would silently
/// orphan every household's stored bias for it).
class SubCuisine {
  const SubCuisine({required this.key, required this.displayLabel});

  final String key;
  final String displayLabel;

  @override
  String toString() => 'SubCuisine($key)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SubCuisine &&
          other.key == key &&
          other.displayLabel == displayLabel;

  @override
  int get hashCode => Object.hash(key, displayLabel);
}

/// Mirrors `MAX_CUISINE_TIER2_KEYS` in
/// `api/src/validation/updateHouseholdSettings.ts`.
const int maxCuisineTier2Keys = 20;

/// Mirrors `MAX_CUISINE_TIER2_KEY_LENGTH` in the same file.
const int maxCuisineTier2KeyLength = 40;

/// The Tier 1 → Tier 2 taxonomy, **verbatim from `docs/PRD.md` §7.3**.
///
/// Nothing here is invented. §7.3 documents sub-cuisines for exactly two of
/// the five schema regions:
///
///  * North Indian — Punjabi, UP/Bihari, Rajasthani, Gujarati, Marathi
///  * South Indian — Tamil, Kerala/Malayali, Andhra/Telangana, Karnataka
///
/// and for "East", which is not a `CuisineTier1` value at all (see
/// [CuisineRegion]'s doc), so its Bengali / Odia / Assamese list has no region
/// to hang from and is omitted.
///
/// **Pan-India, Indo-Chinese and Continental have no documented sub-cuisines,
/// and none are made up for them.** They render no section on wireframe screen
/// 2.5 — which is the honest outcome, not a gap: a fabricated sub-taxonomy
/// would become persisted map keys the recipe library has no matching content
/// for, and would be far harder to remove later than to add now.
///
/// Nine keys total, comfortably inside the server's 20-key bound.
const Map<CuisineRegion, List<SubCuisine>> subCuisineTaxonomy =
    <CuisineRegion, List<SubCuisine>>{
      CuisineRegion.northIndian: <SubCuisine>[
        SubCuisine(key: 'punjabi', displayLabel: 'Punjabi'),
        SubCuisine(key: 'up_bihari', displayLabel: 'UP/Bihari'),
        SubCuisine(key: 'rajasthani', displayLabel: 'Rajasthani'),
        SubCuisine(key: 'gujarati', displayLabel: 'Gujarati'),
        SubCuisine(key: 'marathi', displayLabel: 'Marathi'),
      ],
      CuisineRegion.southIndian: <SubCuisine>[
        SubCuisine(key: 'tamil', displayLabel: 'Tamil'),
        SubCuisine(key: 'kerala_malayali', displayLabel: 'Kerala/Malayali'),
        SubCuisine(key: 'andhra_telangana', displayLabel: 'Andhra/Telangana'),
        SubCuisine(key: 'karnataka', displayLabel: 'Karnataka'),
      ],
      CuisineRegion.panIndia: <SubCuisine>[],
      CuisineRegion.indoChinese: <SubCuisine>[],
      CuisineRegion.continental: <SubCuisine>[],
    };

/// The sub-cuisines documented under [region] — possibly none.
List<SubCuisine> subCuisinesOf(CuisineRegion region) =>
    subCuisineTaxonomy[region] ?? const <SubCuisine>[];

/// Every sub-cuisine of [regions], flattened in taxonomy order.
///
/// Taxonomy order, not selection order, so screen 2.5's sections do not
/// reshuffle when the user goes back and re-taps a chip on 2.4.
List<SubCuisine> subCuisinesForRegions(Set<CuisineRegion> regions) =>
    CuisineRegion.values
        .where(regions.contains)
        .expand(subCuisinesOf)
        .toList(growable: false);

/// The bias map for [regions], defaulting each sub-cuisine to
/// [CuisineBias.defaultBias] but preserving anything already chosen in
/// [existing].
///
/// Keys whose region is no longer selected are **dropped**, which is what
/// keeps the map bounded as the user toggles regions on screen 2.4 — and, more
/// importantly, keeps it honest: a bias for a region the household does not
/// eat is not a preference, it is residue.
Map<String, CuisineBias> defaultWeightsFor(
  Set<CuisineRegion> regions, {
  Map<String, CuisineBias> existing = const <String, CuisineBias>{},
}) => <String, CuisineBias>{
  for (final SubCuisine sub in subCuisinesForRegions(regions))
    sub.key: existing[sub.key] ?? CuisineBias.defaultBias,
};

/// Encodes a bias map as the JSON **string** `cuisineTier2Weights` is on the
/// wire.
///
/// A string, not a `Map`, for the same reason `meal_structure.dart` encodes
/// its own document: `AWSJSON` is `JSON.stringify`'d in both directions
/// (`api/src/mappers/household.ts`), and `build.yaml` maps the scalar to Dart
/// `String` to match.
String encodeCuisineTier2Weights(Map<String, CuisineBias> weights) =>
    jsonEncode(<String, String>{
      for (final MapEntry<String, CuisineBias> entry in weights.entries)
        entry.key: entry.value.wireValue,
    });
