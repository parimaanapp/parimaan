import 'package:flutter/material.dart';

import '../tokens.dart';

/// The Parimaan text field.
///
/// **Engineering call: one component, several configurations.** The design
/// source draws six input flavours — text default, text focused, text error,
/// number + unit, textarea, and search. Three of those (default, focused,
/// error) are *widget states*, not variants: Flutter drives them itself from
/// focus and from [errorText], so they cost nothing but a border resolver. The
/// other three differ only in parameters already present on a text field:
///
///  * **search** = [prefixIcon] + [hintText]
///  * **textarea** = [minLines] / [maxLines]
///  * **number + unit** = [useMonoFont] + [textAlign] + a [trailing] slot for
///    the unit control
///
/// None of them changes the field's anatomy, its border, its padding or its
/// states, so none of them earns a separate widget — a `PSearchInput` would be
/// a `PInput` with two arguments pre-filled and one more file to keep in sync.
/// The unit *picker* itself is deliberately out of scope: it is a select, not
/// an input, and no select is in this slice's ten components — hence the
/// generic [trailing] slot rather than a `units` parameter.
///
/// Stateless by contract: the [TextEditingController] and [FocusNode] are owned
/// by the caller, which keeps this widget golden-testable and lets feature code
/// hold the text in whatever state layer it already uses.
class PInput extends StatelessWidget {
  const PInput({
    super.key,
    required this.label,
    this.controller,
    this.hintText,
    this.helperText,
    this.errorText,
    this.prefixIcon,
    this.trailing,
    this.onChanged,
    this.onSubmitted,
    this.focusNode,
    this.keyboardType,
    this.textInputAction,
    this.textAlign = TextAlign.start,
    this.enabled = true,
    this.obscureText = false,
    this.autofocus = false,
    this.useMonoFont = false,
    this.minLines = 1,
    this.maxLines = 1,
  }) : assert(maxLines >= minLines, 'maxLines must not be below minLines');

  /// Field label, rendered above the box. Supplied by the caller.
  final String label;

  final TextEditingController? controller;
  final String? hintText;

  /// Guidance shown below the field. Hidden while [errorText] is set.
  final String? helperText;

  /// Non-null puts the field in its error state: a [AppColors.danger] border
  /// **and** this message below it. The message is what satisfies the
  /// "never rely on colour alone" rule — a red box with no words is not an
  /// error state, it is a mystery.
  final String? errorText;

  /// Leading glyph — the search configuration's magnifier, for instance.
  final IconData? prefixIcon;

  /// Trailing control rendered beside the field: the unit picker of the
  /// number + unit configuration, a clear button, and so on.
  final Widget? trailing;

  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final FocusNode? focusNode;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final TextAlign textAlign;
  final bool enabled;
  final bool obscureText;
  final bool autofocus;

  /// Render the value in [AppTypography.mono] — quantities, invite codes,
  /// timestamps. Never body copy.
  final bool useMonoFont;

  final int minLines;
  final int maxLines;

  /// Key of the focus-ring [DecoratedBox] around the field box.
  static const Key focusRingKey = Key('p-input-focus-ring');

  /// Focused border width (wireframe: 1.5 px terracotta).
  static const double _focusedBorderWidth = 1.5;

  /// Spread of the focus ring outside the border (wireframe: 3 px).
  static const double _focusRingSpread = 3;

  bool get _hasError => errorText != null;

  @override
  Widget build(BuildContext context) {
    final Widget field = TextField(
      controller: controller,
      focusNode: focusNode,
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      textAlign: textAlign,
      enabled: enabled,
      obscureText: obscureText,
      autofocus: autofocus,
      minLines: minLines,
      maxLines: maxLines,
      cursorColor: AppColors.terracotta,
      style: (useMonoFont ? AppTypography.mono : AppTypography.body).copyWith(
        color: enabled ? AppColors.ink : AppColors.inkMid,
      ),
      decoration: _decoration(),
    );

    final Widget box = _FocusRing(
      child: trailing == null
          ? field
          : Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                Expanded(child: field),
                const SizedBox(width: AppSpacing.s1),
                trailing!,
              ],
            ),
    );

    final String? message = _hasError ? errorText : helperText;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label.toUpperCase(),
          style: AppTypography.mono.copyWith(
            color: AppColors.inkMid,
            fontWeight: FontWeight.w600,
            fontSize: AppTypography.meta.fontSize,
            letterSpacing: 0.12 * AppTypography.meta.fontSize!,
          ),
        ),
        const SizedBox(height: AppSpacing.s0),
        box,
        if (message != null) ...<Widget>[
          const SizedBox(height: AppSpacing.s0),
          Text(
            message,
            style: AppTypography.label.copyWith(
              color: _hasError ? AppColors.danger : AppColors.inkMid,
            ),
          ),
        ],
      ],
    );
  }

  InputDecoration _decoration() => InputDecoration(
    hintText: hintText,
    hintStyle: AppTypography.body.copyWith(color: AppColors.inkMid),
    // Helper and error copy render below the field box (see [build]) so the
    // focus ring hugs the box itself, not the message.
    filled: true,
    fillColor: enabled ? AppColors.card : AppColors.paper2,
    isDense: false,
    prefixIcon: prefixIcon == null
        ? null
        : Icon(prefixIcon, size: AppSizing.icon20, color: AppColors.inkMid),
    prefixIconConstraints: const BoxConstraints(
      minWidth: AppSizing.minTouchTargetWidth,
      minHeight: AppSizing.minTouchTargetHeight,
    ),
    constraints: const BoxConstraints(
      minHeight: AppSizing.minTouchTargetHeight,
    ),
    contentPadding: const EdgeInsets.symmetric(
      horizontal: AppSpacing.s2,
      vertical: AppSpacing.s2,
    ),
    // `errorText` is not passed to the decoration, so the framework never
    // selects an error border; the danger colour is chosen here instead.
    border: _border(AppColors.outlineSoft),
    enabledBorder: _hasError
        ? _border(AppColors.danger)
        : _border(AppColors.outlineSoft),
    disabledBorder: _border(AppColors.paper2),
    focusedBorder: _hasError
        ? _border(AppColors.danger)
        : _border(AppColors.terracotta, _focusedBorderWidth),
  );

  /// Field borders use [AppRadius.m] — `radius.r-m` is the token whose stated
  /// usage is "buttons, inputs". (The wireframe draws them at 10px, which is
  /// not on the radius scale at all; the token wins.)
  OutlineInputBorder _border(Color color, [double? width]) =>
      OutlineInputBorder(
        borderRadius: AppRadius.borderM,
        borderSide: width == null
            ? BorderSide(color: color)
            : BorderSide(color: color, width: width),
      );
}

/// Draws the wireframe's 3px terracotta@12% ring around its child while a
/// descendant holds focus.
class _FocusRing extends StatelessWidget {
  const _FocusRing({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Focus(
    canRequestFocus: false,
    skipTraversal: true,
    child: Builder(
      builder: (BuildContext context) {
        final bool focused = Focus.of(context).hasFocus;
        return DecoratedBox(
          key: PInput.focusRingKey,
          decoration: BoxDecoration(
            borderRadius: AppRadius.borderM,
            boxShadow: focused
                ? const <BoxShadow>[
                    BoxShadow(
                      color: AppColors.terracottaRing,
                      spreadRadius: PInput._focusRingSpread,
                    ),
                  ]
                : null,
          ),
          child: child,
        );
      },
    ),
  );
}
