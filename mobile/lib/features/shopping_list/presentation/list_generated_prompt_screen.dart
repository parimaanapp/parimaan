import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../app/router.dart';
import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

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
  static const Key laterButtonKey = Key('shopping-list-generate-later');
  static const Key noteKey = Key('shopping-list-generate-note');

  void _onLater(BuildContext context) {
    // The prompt is pushed from the plan; if it was opened some other way
    // there is nothing to pop to, so land on the plan rather than a dead end.
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.weeklyPlan);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) =>
            SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.s4),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight - 2 * AppSpacing.s4,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Semantics(
                      header: true,
                      child: Text(
                        'Week is set!',
                        textAlign: TextAlign.center,
                        style: AppTypography.displayM.copyWith(
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s1),
                    Text(
                      'Your meals are confirmed.',
                      textAlign: TextAlign.center,
                      style: AppTypography.body.copyWith(
                        color: AppColors.inkSoft,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s3),
                    DecoratedBox(
                      key: noteKey,
                      decoration: const BoxDecoration(
                        color: AppColors.haldiSoft,
                        borderRadius: AppRadius.borderM,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.s3,
                          vertical: AppSpacing.s2,
                        ),
                        child: Text(
                          'Shopping list can now be generated from these '
                          'recipes.',
                          textAlign: TextAlign.center,
                          style: AppTypography.label.copyWith(
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s4),
                    PButton(
                      key: generateButtonKey,
                      label: 'Generate shopping list',
                      onPressed: () => context.push(
                        AppRoutes.shoppingListPreview,
                        extra: extra,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.s1),
                    PButton(
                      key: laterButtonKey,
                      label: 'I\'ll do it later',
                      variant: PButtonVariant.ghost,
                      onPressed: () => _onLater(context),
                    ),
                  ],
                ),
              ),
            ),
      ),
    ),
  );
}
