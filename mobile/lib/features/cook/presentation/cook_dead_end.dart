import 'package:flutter/material.dart';

import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import 'cook_failure_copy.dart';

/// The shared "no recipes this time" surface (W21 S5): a too-small pantry,
/// nothing grounded, and every real failure all render here. One primary
/// action first, the rest quieter — the design system's "no dead ends",
/// same pattern as W20 S6's `PhotoDeadEnd`.
class CookDeadEnd extends StatelessWidget {
  const CookDeadEnd({super.key, required this.copy, required this.onAction});

  final CookFailureCopy copy;
  final ValueChanged<CookFailureAction> onAction;

  static Key actionKey(CookFailureAction action) =>
      Key('cook-dead-end-${action.name}');

  static String _label(CookFailureAction action) => switch (action) {
    CookFailureAction.retry => 'Try again',
    CookFailureAction.differentVibe => 'Try a different vibe',
    CookFailureAction.addManually => 'Add a recipe myself',
  };

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(AppSpacing.s3),
    child: Center(
      child: SingleChildScrollView(
        child: PEmptyState(
          headline: copy.headline,
          body: copy.body,
          action: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              for (int i = 0; i < copy.actions.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(height: AppSpacing.s1),
                PButton(
                  key: actionKey(copy.actions[i]),
                  label: _label(copy.actions[i]),
                  variant: i == 0
                      ? PButtonVariant.primary
                      : PButtonVariant.ghost,
                  expand: true,
                  onPressed: () => onAction(copy.actions[i]),
                ),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}
