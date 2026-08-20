import 'package:flutter/material.dart';

import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/meal_structure.dart';

/// A labelled `−` / value / `+` row, for wireframe screen 2.3.
///
/// ## Why this is feature-local and not a design-system component
///
/// **`lib/shared/ui/components/` has no stepper.** The ten components in that
/// directory are the set `E2E_MVP_PLAN.md` §3 names, and a numeric stepper is
/// not among them — checked before building this rather than assumed.
///
/// It lives here rather than being promoted for two reasons. Promotion is not
/// just moving a file: everything in that directory carries a golden test, a
/// token-drift test, and a "stateless and provider-free" contract, and adding
/// an eleventh component is a design-system change that belongs to a
/// design-system slice, not to a screen slice. And this control has exactly
/// one consumer so far — a second one (the quantity field on the pantry
/// screens) is the point at which promoting it stops being speculative.
///
/// What it does *not* do is invent visuals: the two controls are [PButton]s
/// and every value comes from the token set. The only thing built by hand is
/// the arrangement.
///
/// ## Accessibility
///
/// The `−` and `+` glyphs are not labels, so each button is wrapped in
/// [Semantics] with real copy and its own glyph excluded — the same pattern
/// `PTopBarBackButton` and `PChip`'s remove affordance use, and for the same
/// reason. The value itself is announced with its slot name rather than as a
/// bare number.
class SlotStepper extends StatelessWidget {
  const SlotStepper({
    super.key,
    required this.slot,
    required this.count,
    required this.onChanged,
    this.enabled = true,
  });

  /// The glyphs the design source draws. Typographic, not an icon set — the
  /// repo still has no Phosphor code-point mapping, exactly as
  /// `PTopBar.backGlyph`'s note says.
  static const String decrementGlyph = '−';
  static const String incrementGlyph = '＋';

  /// Key for the value readout, so a test can assert the number without
  /// matching a bare digit anywhere on screen.
  static Key valueKey(MealSlot slot) => Key('slot-stepper-value-${slot.name}');

  static Key decrementKey(MealSlot slot) =>
      Key('slot-stepper-minus-${slot.name}');

  static Key incrementKey(MealSlot slot) =>
      Key('slot-stepper-plus-${slot.name}');

  final MealSlot slot;
  final int count;

  /// Called with the requested new count. The clamping to `[0, 10]` is the
  /// domain's job, not this widget's — see `LunchMealStructure.withCount`.
  final ValueChanged<int> onChanged;

  final bool enabled;

  bool get _canDecrement => enabled && count > LunchMealStructure.minSlots;
  bool get _canIncrement => enabled && count < LunchMealStructure.maxSlots;

  @override
  Widget build(BuildContext context) => PCard(
    padding: const EdgeInsets.symmetric(
      horizontal: AppSpacing.s2,
      vertical: AppSpacing.s1,
    ),
    child: Row(
      children: <Widget>[
        Expanded(
          child: Text(
            slot.displayLabel,
            style: AppTypography.body.copyWith(color: AppColors.ink),
          ),
        ),
        _StepButton(
          buttonKey: decrementKey(slot),
          glyph: decrementGlyph,
          semanticLabel: 'One fewer ${slot.displayLabel}',
          onPressed: _canDecrement ? () => onChanged(count - 1) : null,
        ),
        Semantics(
          label: '${slot.displayLabel}: $count',
          excludeSemantics: true,
          child: SizedBox(
            width: AppSpacing.s5,
            child: Text(
              '$count',
              key: valueKey(slot),
              textAlign: TextAlign.center,
              style: AppTypography.mono.copyWith(color: AppColors.ink),
            ),
          ),
        ),
        _StepButton(
          buttonKey: incrementKey(slot),
          glyph: incrementGlyph,
          semanticLabel: 'One more ${slot.displayLabel}',
          onPressed: _canIncrement ? () => onChanged(count + 1) : null,
        ),
      ],
    ),
  );
}

/// One `−`/`+` control: a [PButton] carrying a glyph, with real screen-reader
/// copy layered over it.
class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.buttonKey,
    required this.glyph,
    required this.semanticLabel,
    required this.onPressed,
  });

  final Key buttonKey;
  final String glyph;
  final String semanticLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    enabled: onPressed != null,
    label: semanticLabel,
    child: ExcludeSemantics(
      child: PButton(
        key: buttonKey,
        label: glyph,
        variant: PButtonVariant.secondary,
        size: PButtonSize.small,
        onPressed: onPressed,
      ),
    ),
  );
}
