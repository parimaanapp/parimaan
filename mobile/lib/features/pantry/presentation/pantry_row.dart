import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/pantry_item.dart';

/// One row in the Pantry List (wireframe 9.1) — name, quantity+unit, and
/// the staple / running-low affordances, matching `MembersListScreen`'s
/// `_MemberRow` shape (a `PCard` per row, not a plain `ListTile`). Tapping
/// the row opens it in edit mode (S6's `ManualAddScreen`, reused); the
/// trailing delete icon opens `delete_pantry_item_dialog.dart`'s confirm —
/// both are optional so this widget stays usable in a context (a future
/// read-only view) that wants neither.
class PantryRow extends StatelessWidget {
  const PantryRow({super.key, required this.item, this.onTap, this.onDelete});

  final PantryItem item;

  /// Opens the item in edit mode. `null` renders a non-interactive row.
  final VoidCallback? onTap;

  /// Opens the delete confirmation. `null` hides the delete affordance.
  final VoidCallback? onDelete;

  static const Key stapleBadgeKey = Key('pantry-row-staple');
  static const Key runningLowBadgeKey = Key('pantry-row-running-low');
  static const Key expiryKey = Key('pantry-row-expiry');
  static const Key deleteButtonKey = Key('pantry-row-delete');

  @override
  Widget build(BuildContext context) {
    final String? expiryDate = item.expiryDate;
    final VoidCallback? onDelete = this.onDelete;

    return PCard(
      onTap: onTap,
      semanticLabel: '${item.name}, ${_quantityLabel()}',
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  item.name,
                  style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
                ),
                const SizedBox(height: AppSpacing.s0),
                Text(
                  _quantityLabel(),
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                ),
                if (expiryDate != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.s0),
                  Text(
                    'Expires $expiryDate',
                    key: expiryKey,
                    style: AppTypography.label.copyWith(color: AppColors.inkMid),
                  ),
                ],
              ],
            ),
          ),
          if (item.isStaple) ...<Widget>[
            const SizedBox(width: AppSpacing.s1),
            const PBadge(
              key: stapleBadgeKey,
              label: 'Staple',
              tone: PBadgeTone.neutral,
            ),
          ],
          if (item.isRunningLow) ...<Widget>[
            const SizedBox(width: AppSpacing.s1),
            const PBadge(
              key: runningLowBadgeKey,
              label: 'Low',
              tone: PBadgeTone.warning,
            ),
          ],
          if (onDelete != null) ...<Widget>[
            const SizedBox(width: AppSpacing.s1),
            PIconButton(
              key: deleteButtonKey,
              icon: Icons.delete_outline,
              semanticLabel: 'Delete ${item.name}',
              variant: PButtonVariant.ghost,
              onPressed: onDelete,
            ),
          ],
        ],
      ),
    );
  }

  String _quantityLabel() => '${item.quantity} ${item.unit}';
}
