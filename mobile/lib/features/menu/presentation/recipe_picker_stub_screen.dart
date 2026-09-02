import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';

/// The honest stand-in for the recipe picker — tapping an empty slot on the
/// Weekly plan grid lands here today (E2E_MVP_PLAN.md §15.3 S5). The real
/// picker, filtered by the tapped slot's role, is W10's own slice
/// (§15.1's explicit out-of-scope list); `autoFillWeek` is W10 too.
///
/// Same "a real route with a real `PEmptyState`, never a dead tap or a
/// fabricated picker" posture `SettingsPlaceholderScreen` established —
/// written as its own small screen here rather than reusing that one, since
/// its `build()` hardcodes navigating back to the Settings hub, which is not
/// where this belongs.
class RecipePickerStubScreen extends StatelessWidget {
  const RecipePickerStubScreen({super.key, required this.onBack});

  /// Where "Back to weekly plan" goes — supplied by the caller rather than
  /// hardcoded, since this screen has no household/week context of its own
  /// to build that destination from.
  final VoidCallback onBack;

  static const Key emptyStateKey = Key('recipe-picker-stub');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Add a recipe',
            onBack: onBack,
            backSemanticLabel: 'Back to weekly plan',
          ),
          Expanded(
            child: Center(
              child: PEmptyState(
                key: emptyStateKey,
                headline: 'Coming soon',
                body: 'Picking a recipe for this slot will be here soon. For now, add recipes from the Recipes tab.',
                action: PButton(
                  label: 'Back to weekly plan',
                  variant: PButtonVariant.secondary,
                  onPressed: onBack,
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
