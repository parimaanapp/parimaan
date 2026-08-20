import 'package:flutter/material.dart';

import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';

/// The chrome every setup screen shares: top bar, step indicator, serif
/// heading, hint line, scrolling content, a pinned bottom action, and one
/// place for a server error.
///
/// Extracted because the six wizard screens are the *same* screen with
/// different middles — five copies of this layout would be five places for the
/// step indicator or the error line to drift. Nothing here is a new visual
/// pattern: it is [PTopBar] + tokens + a [PButton], composed.
class WizardStepScaffold extends StatelessWidget {
  const WizardStepScaffold({
    super.key,
    required this.onBack,
    required this.backSemanticLabel,
    required this.children,
    this.topBarTitle = defaultTopBarTitle,
    this.stepIndicator,
    this.heading,
    this.hint,
    this.action,
    this.errorMessage,
  });

  /// Wireframe screens 2.2–2.6 all title the bar "Setup"; only 2.1 differs.
  static const String defaultTopBarTitle = 'Setup';

  /// Lets a widget test assert the *absence* of the error line, which
  /// `find.text` cannot express for conditionally-built copy. Same trick as
  /// `SignInScreen.errorKey`.
  static const Key errorKey = Key('wizard-server-error');

  /// Identifies the "1/4"-style step indicator.
  static const Key stepIndicatorKey = Key('wizard-step-indicator');

  final VoidCallback onBack;
  final String backSemanticLabel;

  /// Bar title — "Setup" for every step but the first.
  final String topBarTitle;

  /// The trailing "1/4" progress text, or null on a screen outside the count.
  final String? stepIndicator;

  /// The Instrument Serif screen heading ("Which meals?", "Lunch structure").
  ///
  /// Separate from [topBarTitle] because the wireframe draws both: a small
  /// meta bar title *and* a large serif heading below it.
  final String? heading;

  /// The single explanatory line under [heading].
  final String? hint;

  /// The screen's body.
  final List<Widget> children;

  /// Pinned to the bottom, outside the scroll view, so "Continue" stays
  /// reachable on a short screen with a long list.
  final Widget? action;

  /// Rendered above [action] when a submit failed. Above rather than below so
  /// it is between the content and the button the user is about to press
  /// again.
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    final String? errorMessage = this.errorMessage;

    return Scaffold(
      backgroundColor: AppColors.paper,
      // `PTopBar` is a plain widget, not a `PreferredSizeWidget`, so it goes
      // at the top of the body rather than in `Scaffold.appBar`.
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: topBarTitle,
              onBack: onBack,
              backSemanticLabel: backSemanticLabel,
              trailing: stepIndicator == null
                  ? null
                  : Text(
                      stepIndicator!,
                      key: stepIndicatorKey,
                      style: AppTypography.mono.copyWith(
                        color: AppColors.inkMid,
                      ),
                    ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.s3,
                  0,
                  AppSpacing.s3,
                  AppSpacing.s3,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    if (heading != null) ...<Widget>[
                      Text(
                        heading!,
                        style: AppTypography.title.copyWith(
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s0),
                    ],
                    if (hint != null) ...<Widget>[
                      Text(
                        hint!,
                        style: AppTypography.label.copyWith(
                          color: AppColors.inkMid,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s3),
                    ],
                    ...children,
                  ],
                ),
              ),
            ),
            if (errorMessage != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.s3,
                  0,
                  AppSpacing.s3,
                  AppSpacing.s2,
                ),
                child: Text(
                  errorMessage,
                  key: errorKey,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ),
            if (action != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.s3,
                  0,
                  AppSpacing.s3,
                  AppSpacing.s3,
                ),
                child: action,
              ),
          ],
        ),
      ),
    );
  }
}

/// The all-caps meta label the wireframe uses above a section ("DIETARY",
/// "UNDER NORTH INDIAN").
///
/// `AppTypography.meta` declares `"transform": "uppercase"` in the token file,
/// which `TextStyle` cannot express — so uppercasing is the caller's job, and
/// this is that caller, in one place rather than at every section.
class WizardSectionLabel extends StatelessWidget {
  const WizardSectionLabel({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s1),
    child: Text(
      label.toUpperCase(),
      style: AppTypography.meta.copyWith(color: AppColors.inkMid),
    ),
  );
}
