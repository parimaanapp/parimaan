import 'package:flutter/material.dart';

import '../tokens.dart';
import 'p_card.dart';

/// The empty state from the design source: *"Warm illustration slot + serif
/// italic headline + one primary action. No dead ends."*
///
/// [action] is **required**, deliberately. "No dead ends" is the whole point of
/// the pattern — an empty state with nothing to do is a wall, and making the
/// action optional would let one ship by accident. A screen that genuinely has
/// no next step is not an empty state; it is a message, and should render as
/// one.
///
/// The illustration slot falls back to a placeholder because real illustrations
/// are a later asset slice. Callers pass the finished artwork through
/// [illustration] once it exists — nothing else about the component changes.
class PEmptyState extends StatelessWidget {
  const PEmptyState({
    super.key,
    required this.headline,
    required this.body,
    required this.action,
    this.illustration,
  });

  /// Identifies the placeholder slot, so a screen (or a test) can tell the
  /// stand-in from real artwork.
  static const Key illustrationKey = Key('p_empty_state_illustration');

  /// The illustration slot's edge.
  ///
  /// The design source draws it at 96pt, which is not on the 4pt spacing scale;
  /// it is expressed as a sum of scale steps rather than as a new literal.
  static const double illustrationSize = AppSpacing.s6 * 2;

  /// Serif italic headline — "warmth, used sparingly", exactly as the type
  /// rules prescribe. Supplied by the caller.
  final String headline;

  /// Supporting copy. Supplied by the caller.
  final String body;

  /// The way out. Usually a primary `PButton`.
  final Widget action;

  /// Real artwork, when it exists. Falls back to a placeholder slot.
  final Widget? illustration;

  @override
  Widget build(BuildContext context) => PCard(
    padding: const EdgeInsets.symmetric(
      horizontal: AppSpacing.s4,
      vertical: AppSpacing.s5,
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: <Widget>[
        illustration ?? const _IllustrationPlaceholder(),
        const SizedBox(height: AppSpacing.s4),
        Text(
          headline,
          textAlign: TextAlign.center,
          style: AppTypography.displayM.copyWith(
            color: AppColors.ink,
            fontStyle: FontStyle.italic,
          ),
        ),
        const SizedBox(height: AppSpacing.s1),
        Text(
          body,
          textAlign: TextAlign.center,
          // Body copy uses ink or inkSoft — never the inkMid meta ink.
          style: AppTypography.body.copyWith(color: AppColors.inkSoft),
        ),
        const SizedBox(height: AppSpacing.s4),
        action,
      ],
    ),
  );
}

/// Stand-in for artwork that has not been drawn yet — a warm haldi tile at the
/// illustration slot's size, so layout and spacing are already correct when the
/// real asset lands.
class _IllustrationPlaceholder extends StatelessWidget {
  const _IllustrationPlaceholder();

  @override
  Widget build(BuildContext context) => Container(
    key: PEmptyState.illustrationKey,
    width: PEmptyState.illustrationSize,
    height: PEmptyState.illustrationSize,
    decoration: const BoxDecoration(
      color: AppColors.haldiSoft,
      borderRadius: AppRadius.borderXl,
    ),
  );
}
