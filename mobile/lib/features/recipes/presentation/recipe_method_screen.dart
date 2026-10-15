import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// Wireframe 8.1 — "how do you want to add this recipe": Structured entry,
/// URL import, or Freeform paste. Both `RecipesLibraryScreen` FAB call
/// sites route here now instead of straight to the structured form
/// (`E2E_MVP_PLAN.md` §13.3 S8) — Structured entry's own card continues to
/// that same, unchanged route.
///
/// **All three options render at equal visual prominence** — S1's JSON-LD
/// coverage spike landed 14/20 usable drafts, D10's 10–15/20 middle tier
/// (§13.5.12), which locks URL import and Freeform paste as co-equal, not
/// URL-primary. Unlike `AddMethodScreen`'s W5 precedent (one option
/// genuinely not built yet, shown disabled per §11.2.8), none of the three
/// options here are disabled: S8 ships real routes for all three, even
/// though URL/Freeform's own destination screens are themselves
/// placeholders pending S9/S10 (see `UrlImportScreen`/`FreeformInputScreen`'s
/// own docs) — a placeholder is a real, reachable destination, not a
/// disabled one.
class RecipeMethodScreen extends StatelessWidget {
  const RecipeMethodScreen({super.key, required this.householdId});

  final String householdId;

  static const Key structuredButtonKey = Key('recipe-method-structured');
  static const Key urlButtonKey = Key('recipe-method-url');
  static const Key freeformButtonKey = Key('recipe-method-freeform');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Add a recipe',
            onBack: () => context.pop(),
            backSemanticLabel: 'Back to recipes',
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _MethodCard(
                  itemKey: structuredButtonKey,
                  title: 'Type it in',
                  body: 'Fill in the title, ingredients and steps yourself.',
                  onTap: () =>
                      context.push(AppRoutes.recipeCreate(householdId)),
                ),
                const SizedBox(height: AppSpacing.s2),
                _MethodCard(
                  itemKey: urlButtonKey,
                  title: 'Import from a link',
                  body: 'Paste a link to a recipe and let Parimaan read it.',
                  onTap: () =>
                      context.push(AppRoutes.recipeUrlImport(householdId)),
                ),
                const SizedBox(height: AppSpacing.s2),
                _MethodCard(
                  itemKey: freeformButtonKey,
                  title: 'Paste recipe text',
                  body: 'Paste text from anywhere and let Parimaan structure it.',
                  onTap: () =>
                      context.push(AppRoutes.recipeFreeformInput(householdId)),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

/// Same visual language as `AddMethodScreen`'s own `_MethodCard` — not
/// shared code between the two (different feature directories, and this
/// one has no disabled state to support, so `PCard`'s own `onTap`/
/// `semanticLabel` are enough without a manual `Semantics` wrapper).
class _MethodCard extends StatelessWidget {
  const _MethodCard({
    required this.itemKey,
    required this.title,
    required this.body,
    required this.onTap,
  });

  final Key itemKey;
  final String title;
  final String body;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => PCard(
    key: itemKey,
    onTap: onTap,
    semanticLabel: title,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          title,
          style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
        ),
        const SizedBox(height: AppSpacing.s0),
        Text(
          body,
          style: AppTypography.label.copyWith(color: AppColors.inkMid),
        ),
      ],
    ),
  );
}
