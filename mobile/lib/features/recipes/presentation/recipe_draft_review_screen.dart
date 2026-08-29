import 'package:flutter/material.dart';

import '../domain/ai_recipe_draft.dart';
import 'recipe_form_screen.dart';

/// Wireframe 8.5 — the shared review screen both S9 (URL import) and S10
/// (freeform paste) land on. A thin routed wrapper, deliberately with no
/// logic of its own: `RecipeFormScreen`'s own review mode (its
/// [RecipeFormScreen.initialDraft]/[RecipeFormScreen.sourceUrl]) is the
/// actual seeded-wrapper implementation (D6, §11.2.7's pattern, third
/// use) — this screen exists only because `AppRoutes.recipeDraftReview`
/// needs a `builder` to hand a routed [state.extra] to, not because the
/// review UI itself lives here.
class RecipeDraftReviewScreen extends StatelessWidget {
  const RecipeDraftReviewScreen({
    super.key,
    required this.householdId,
    required this.draft,
    this.sourceUrl,
  });

  final String householdId;
  final AiRecipeDraft draft;

  /// Present when [draft] came from `importRecipeFromUrl` (S9), absent for
  /// a freeform paste (S10) — forwarded straight through to
  /// `RecipeFormScreen`, which uses it both for the attribution line and
  /// the `source` argument on confirm.
  final String? sourceUrl;

  @override
  Widget build(BuildContext context) => RecipeFormScreen(
    householdId: householdId,
    initialDraft: draft,
    sourceUrl: sourceUrl,
  );
}
