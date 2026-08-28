import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';

/// Wireframe 8.4 — placeholder.
///
/// Same "real route today, real screen later" shape as
/// [UrlImportScreen]'s own doc explains — S8's chooser needs somewhere real
/// to send the freeform-paste option. **S10 replaces this file's contents**
/// with the real screen (a large paste field, a 4,000-char live counter,
/// then the shared draft review screen) — the route stays the same.
class FreeformInputScreen extends StatelessWidget {
  const FreeformInputScreen({super.key, required this.householdId});

  final String householdId;

  static const Key emptyStateKey = Key('freeform-input-placeholder');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Paste a recipe',
            onBack: () => context.pop(),
            backSemanticLabel: 'Back',
          ),
          Expanded(
            child: Center(
              child: PEmptyState(
                key: emptyStateKey,
                headline: 'Coming soon',
                body:
                    'Pasting recipe text from anywhere and letting Parimaan '
                    'structure it for you is on its way.',
                action: PButton(
                  label: 'Back',
                  variant: PButtonVariant.secondary,
                  onPressed: () => context.pop(),
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
