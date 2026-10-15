import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';

/// "◆ Staples check" (wireframe 10.1): a haldi-soft card under the list that
/// says which staples to verify at home. [note] is the server's own
/// `aiStaplesNote`, shown verbatim.
class StaplesCheckCard extends StatelessWidget {
  const StaplesCheckCard({super.key, required this.note});

  final String note;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: AppColors.haldiSoft,
      borderRadius: AppRadius.borderM,
    ),
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            '◆ Staples check',
            style: AppTypography.label.copyWith(
              color: AppColors.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: AppSpacing.s0),
          Text(
            note,
            style: AppTypography.label.copyWith(color: AppColors.inkSoft),
          ),
        ],
      ),
    ),
  );
}
