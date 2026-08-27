/// Where a recipe came from — `RecipeSource` in `shared/schema.graphql`.
/// Never client-suppliable on create/update (the server sets it); read-only
/// on the domain [Recipe][see-also] for display purposes only in W6 (a
/// "how was this added" affordance is a later slice, not this one).
///
/// [unknown] is the same forward-compatibility landing spot as
/// `RecipeRole.unknown`.
enum RecipeSource {
  user,
  url,
  curated,
  ai,
  freeformAi,
  unknown;

  /// The exact `RecipeSource` value name in `shared/schema.graphql`.
  String get wireValue => switch (this) {
    RecipeSource.user => 'user',
    RecipeSource.url => 'url',
    RecipeSource.curated => 'curated',
    RecipeSource.ai => 'ai',
    RecipeSource.freeformAi => 'freeform_ai',
    RecipeSource.unknown => 'unknown',
  };
}
