import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';

/// Wireframe "Week confirmed -> list prompt" (35/49, E2E_MVP_PLAN.md §17.1/
/// §17.3 S6) — a single, static confirmation step between `WeeklyPlanScreen`'s
/// "Generate shopping list" affordance and the real generation call.
///
/// This screen itself calls nothing — it exists purely so the write
/// (`generateShoppingList`, actually triggered by `ListPreviewScreen` reading
/// `CurrentShoppingListController` for the first time) is one deliberate tap
/// away from the weekly plan, not an instant side effect of the trailing
/// icon button. No back-and-forth data to lose here, so there is no confirm
/// dialog of its own — the confirm dialog on this codebase's own regenerate
/// flow exists because regenerating can discard state; a first-time generate
/// cannot.
class ListGeneratedPromptScreen extends StatelessWidget {
  const ListGeneratedPromptScreen({super.key, required this.extra});

  final ShoppingListFlowExtra extra;

  static const Key generateButtonKey = Key('shopping-list-generate-prompt');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Shopping list',
            onBack: () => context.pop(),
            backSemanticLabel: 'Back to weekly plan',
          ),
          Expanded(
            child: Center(
              child: PEmptyState(
                headline: 'Your week is planned.',
                body:
                    'Build a shopping list from this week\'s menu — staples '
                    'you already keep on hand are left off automatically.',
                action: PButton(
                  key: ListGeneratedPromptScreen.generateButtonKey,
                  label: 'Build shopping list',
                  onPressed: () =>
                      context.push(AppRoutes.shoppingListPreview, extra: extra),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
