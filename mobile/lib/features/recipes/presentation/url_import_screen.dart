import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';

/// Wireframe 8.3 — placeholder.
///
/// S8 (`E2E_MVP_PLAN.md` §13.3) needs a real route the "Choose method"
/// chooser can send the URL-import option to today, not a TODO — the
/// design-system's "no dead ends" rule (`SettingsPlaceholderScreen`'s own
/// precedent) applies here just as it does to an unbuilt Settings row.
/// **S9 replaces this file's contents with the real screen** (URL field,
/// paste-from-clipboard, honest in-flight state) — the route this screen
/// answers to does not change, only what lives behind it.
class UrlImportScreen extends StatelessWidget {
  const UrlImportScreen({super.key, required this.householdId});

  final String householdId;

  static const Key emptyStateKey = Key('url-import-placeholder');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Import from a link',
            onBack: () => context.pop(),
            backSemanticLabel: 'Back',
          ),
          Expanded(
            child: Center(
              child: PEmptyState(
                key: emptyStateKey,
                headline: 'Coming soon',
                body:
                    'Pasting a recipe link and letting Parimaan read it for '
                    'you is on its way.',
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
