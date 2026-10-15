import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/sizing.dart';

/// The check on a shopping-list row (wireframe 10.1, approved in
/// `component-alignment-v1.html`): an 18 px box with radius 6, green fill and
/// a tick when done. The visible box is 18 px; the tap target around it is
/// 44 x 44 so it stays reachable.
///
/// [onChanged] null disables the control (it is in flight); the semantics
/// then report it as disabled rather than hiding it.
class ChecklistCheckBox extends StatelessWidget {
  const ChecklistCheckBox({
    super.key,
    required this.itemId,
    required this.isChecked,
    required this.onChanged,
    required this.semanticLabel,
  });

  final String itemId;

  final bool isChecked;

  final VoidCallback? onChanged;

  final String semanticLabel;

  static const double boxSize = 18;
  static const double boxRadius = 6;

  /// Key on the 18 px visual box itself, addressable without the 44 pt tap
  /// target around it.
  static Key boxKey(String itemId) => Key('checklist-item-box-$itemId');

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    button: true,
    checked: isChecked,
    enabled: onChanged != null,
    label: semanticLabel,
    onTap: onChanged,
    excludeSemantics: true,
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onChanged,
      child: SizedBox(
        width: AppSizing.minTouchTargetWidth,
        height: AppSizing.minTouchTargetHeight,
        child: Center(
          child: Container(
            key: boxKey(itemId),
            width: boxSize,
            height: boxSize,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: isChecked ? AppColors.cardamom : null,
              borderRadius: BorderRadius.circular(boxRadius),
              border: Border.all(
                color: isChecked
                    ? AppColors.cardamom
                    : AppColors.ink.withValues(alpha: 0.25),
                width: 1.5,
              ),
            ),
            child: isChecked
                ? const Icon(Icons.check, size: 14, color: AppColors.card)
                : null,
          ),
        ),
      ),
    ),
  );
}
