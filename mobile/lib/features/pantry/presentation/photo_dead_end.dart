import 'package:flutter/material.dart';

import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import 'photo_analysis_failure_copy.dart';

/// The shared "photo didn't work out" surface (W20 S6): the empty-shelf answer,
/// every failure, and a review the user has emptied all render here. One
/// primary action first, the rest quieter — the design system's "no dead ends".
class PhotoDeadEnd extends StatelessWidget {
  const PhotoDeadEnd({super.key, required this.copy, required this.onAction});

  final PhotoFailureCopy copy;
  final ValueChanged<PhotoFailureAction> onAction;

  static Key actionKey(PhotoFailureAction action) =>
      Key('photo-dead-end-${action.name}');

  static String _label(PhotoFailureAction action) => switch (action) {
    PhotoFailureAction.retry => 'Try again',
    PhotoFailureAction.retake => 'Retake photo',
    PhotoFailureAction.addManually => 'Add manually',
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
