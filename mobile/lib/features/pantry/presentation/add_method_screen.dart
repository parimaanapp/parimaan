import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// Wireframe screen 9.2 — "Add choose method".
///
/// Manual is the only live method this week; Photo (W18) is rendered
/// present-but-disabled with a "Coming soon" `Tooltip`, matching
/// `MembersListScreen`'s `_MemberRow` overflow-button precedent
/// (E2E_MVP_PLAN.md §11.2.8) rather than hiding the option or leaving it a
/// live dead end.
class AddMethodScreen extends StatelessWidget {
  const AddMethodScreen({super.key, required this.onManual, this.onBack});

  final VoidCallback onManual;
  final VoidCallback? onBack;

  static const Key manualButtonKey = Key('add-method-manual');
  static const Key photoButtonKey = Key('add-method-photo');

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Add item',
            onBack: onBack ?? () => Navigator.of(context).pop(),
            backSemanticLabel: 'Back to pantry',
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                _MethodCard(
                  semanticsKey: manualButtonKey,
                  title: 'Add manually',
                  body: 'Type in the name, quantity and unit yourself.',
                  onTap: onManual,
                ),
                const SizedBox(height: AppSpacing.s2),
                Tooltip(
                  message: 'Coming soon',
                  child: _MethodCard(
                    semanticsKey: photoButtonKey,
                    title: 'Add from a photo',
                    body:
                        'Snap a photo of your shelf and let AI read what\'s '
                        'there — coming soon.',
                    onTap: null,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
}

class _MethodCard extends StatelessWidget {
  const _MethodCard({
    required this.semanticsKey,
    required this.title,
    required this.body,
    required this.onTap,
  });

  /// Identifies the `Semantics` node this builds — not this widget's own
  /// `key` (which stays unset; `_MethodCard` itself is never looked up by
  /// key, only the accessibility node it produces is).
  final Key semanticsKey;
  final String title;
  final String body;

  /// `null` renders the card visibly disabled — no dead tap, and honestly
  /// inert rather than pretending to respond.
  final VoidCallback? onTap;

  bool get _isEnabled => onTap != null;

  @override
  Widget build(BuildContext context) => Semantics(
    key: semanticsKey,
    button: true,
    enabled: _isEnabled,
    label: _isEnabled ? title : '$title — Coming soon',
    child: ExcludeSemantics(
      child: Opacity(
        opacity: _isEnabled ? 1 : 0.5,
        child: PCard(
          child: InkWell(
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    title,
                    style: AppTypography.bodyStrong.copyWith(
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.s0),
                  Text(
                    body,
                    style: AppTypography.label.copyWith(
                      color: AppColors.inkMid,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
