import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/radius.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/invite_code.dart';

/// The six-box invite-code entry from wireframe screen 3.1.
///
/// ## One field, six boxes — not six fields
///
/// The boxes are **decoration over a single `TextField`**. Six real fields
/// would mean six focus nodes, six controllers, and hand-written
/// advance-on-type and backspace-to-previous logic — and would break paste
/// entirely, which is how most people will actually enter a code they were
/// sent. One hidden field with a painted row on top keeps paste, selection,
/// autofill, and the platform's own keyboard handling working for free.
///
/// The visible boxes are therefore not interactive; the whole row is one tap
/// target that focuses the single underlying field.
///
/// ## Filtering, not validating
///
/// [FilteringTextInputFormatter] drops any keystroke outside the generator's
/// 31-character alphabet, and an uppercasing formatter follows it. That is the
/// job `isInviteCodeCharacter` exists for, per `invite_code.dart`'s note: it
/// stops a typo becoming a code, rather than rejecting a finished one. The
/// *length* rule is still checked by `validateInviteCode`, and the server is
/// still the authority on whether the code exists.
class InviteCodeField extends StatelessWidget {
  const InviteCodeField({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.onSubmitted,
    this.enabled = true,
  });

  static const Key hiddenFieldKey = Key('invite-code-input');

  static Key boxKey(int index) => Key('invite-code-box-$index');

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onSubmitted;
  final bool enabled;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'Invite code, $inviteCodeLength characters',
    textField: true,
    child: Stack(
      alignment: Alignment.center,
      children: <Widget>[
        // The real field, present but invisible. Sized to the row so its own
        // hit area matches the boxes drawn over it, and kept in the tree
        // (rather than `Offstage`) so focus and the platform keyboard behave
        // normally.
        Opacity(
          opacity: 0,
          child: TextField(
            key: hiddenFieldKey,
            controller: controller,
            focusNode: focusNode,
            enabled: enabled,
            autofocus: true,
            maxLength: inviteCodeLength,
            textCapitalization: TextCapitalization.characters,
            keyboardType: TextInputType.visiblePassword,
            textInputAction: TextInputAction.done,
            onSubmitted: onSubmitted,
            inputFormatters: <TextInputFormatter>[
              FilteringTextInputFormatter.allow(
                RegExp(
                  '[$inviteCodeAlphabet${inviteCodeAlphabet.toLowerCase()}]',
                ),
              ),
              _UpperCaseFormatter(),
            ],
            decoration: const InputDecoration(counterText: ''),
          ),
        ),
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: enabled ? focusNode.requestFocus : null,
          child: ValueListenableBuilder<TextEditingValue>(
            valueListenable: controller,
            builder: (
              BuildContext context,
              TextEditingValue value,
              Widget? _,
            ) => _BoxRow(code: value.text, enabled: enabled),
          ),
        ),
      ],
    ),
  );
}

class _BoxRow extends StatelessWidget {
  const _BoxRow({required this.code, required this.enabled});

  final String code;
  final bool enabled;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: <Widget>[
      for (int index = 0; index < inviteCodeLength; index++) ...<Widget>[
        if (index > 0) const SizedBox(width: AppSpacing.s1),
        _CharacterBox(
          key: InviteCodeField.boxKey(index),
          character: index < code.length ? code[index] : '',
          // The next box to be filled is highlighted, so the row reads as a
          // cursor position without a real caret being visible.
          isNext: enabled && index == code.length,
        ),
      ],
    ],
  );
}

class _CharacterBox extends StatelessWidget {
  const _CharacterBox({
    super.key,
    required this.character,
    required this.isNext,
  });

  /// Sized from the token scale rather than a magic number: wide enough for one
  /// mono glyph at display size, and taller than the 44pt minimum touch target
  /// so the row as a whole is comfortably tappable.
  static const double boxWidth = AppSpacing.s6;
  static const double boxHeight = AppSpacing.s7;

  final String character;
  final bool isNext;

  @override
  Widget build(BuildContext context) => Container(
    width: boxWidth,
    height: boxHeight,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: AppRadius.borderM,
      border: Border.all(
        color: isNext ? AppColors.terracotta : AppColors.paper2,
        width: isNext ? 2 : 1,
      ),
    ),
    child: Text(
      character,
      style: AppTypography.mono.copyWith(
        color: AppColors.ink,
        fontSize: AppTypography.displayM.fontSize,
      ),
    ),
  );
}

/// Uppercases as the user types.
///
/// A formatter rather than `.toUpperCase()` at read time so what is *shown* in
/// the boxes is exactly what will be sent — a field that displays `k4m9pq`
/// while sending `K4M9PQ` is a small lie that makes a `NOT_FOUND` impossible to
/// debug from a screenshot.
class _UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) => TextEditingValue(
    text: newValue.text.toUpperCase(),
    selection: newValue.selection,
    composing: TextRange.empty,
  );
}
