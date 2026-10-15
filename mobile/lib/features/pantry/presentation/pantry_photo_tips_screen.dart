import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// W19 §26.1 — the pre-camera tips screen for "Add from a photo".
///
/// Exactly three tips, each one line, drawn directly from W19 S2's real
/// 59-photo Gemini spike (`E2E_MVP_PLAN.md` §25.5) rather than generic
/// photography advice:
///
/// 1. Occlusion (too much crammed into one frame) was the single biggest
///    failure mode — tip 1 combines "one shelf per photo" with "keep
///    everything on it in view" into one line, per the founder's own call
///    (not two separate tips: within one shelf's frame, don't crop it off).
/// 2. Labels turned away from the camera (fridge-door jars especially) was
///    a repeat, named failure mode.
/// 3. All 6 of the real photos that returned zero identified items were
///    specifically dim shots — the one failure mode that's purely fixable
///    by lighting alone.
///
/// **Deliberately excludes an "opaque containers" tip** — per the
/// founder's own call, that's handled as a quiet fallback (the item simply
/// never gets proposed) rather than advice given before the camera even
/// opens, since a user can't act on it in the moment and it reads as a
/// demand to change their storage.
class PantryPhotoTipsScreen extends StatelessWidget {
  const PantryPhotoTipsScreen({super.key, required this.onContinue, this.onBack});

  /// Called when the user taps through to the camera screen.
  final VoidCallback onContinue;
  final VoidCallback? onBack;

  static const Key continueButtonKey = Key('pantry-photo-tips-continue');

  static const List<String> _tips = <String>[
    'One shelf per photo — keep everything on it in view',
    'Turn labels to face the camera',
    'Good light — turn on a light or use flash in dark cabinets',
  ];

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Before you snap a photo',
            onBack: onBack ?? () => Navigator.of(context).pop(),
            backSemanticLabel: 'Back',
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  for (final String tip in _tips) ...<Widget>[
                    _TipRow(text: tip),
                    const SizedBox(height: AppSpacing.s2),
                  ],
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: PButton(
              key: continueButtonKey,
              label: 'Open camera',
              onPressed: onContinue,
              expand: true,
            ),
          ),
        ],
      ),
    ),
  );
}

class _TipRow extends StatelessWidget {
  const _TipRow({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Icon(Icons.check_circle, size: 20, color: AppColors.cardamom, semanticLabel: null),
      ),
      const SizedBox(width: AppSpacing.s2),
      Expanded(child: Text(text, style: AppTypography.body)),
    ],
  );
}
