import 'package:flutter/material.dart';

import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/tokens.dart';
import '../domain/proposed_field.dart';

/// The fifth WS-5 domain widget (E2E_MVP_PLAN.md §13.2.17). Wraps a single
/// [ProposedField], adding the shared "this came from an AI parse or a
/// third-party page, not yet confirmed" visual/semantic treatment, plus
/// non-blocking [warnings] and defensive truncation of an absurdly long
/// value. Built generic over `T` on purpose: W18's photo-pantry review and
/// W19's cook-from-pantry review are its second and third consumers, not
/// just this week's recipe-draft review, so nothing here is recipe-shaped.
///
/// Not a `lib/shared/ui/` design-system primitive — a domain widget gets
/// behaviour tests, never a golden (`DEV_WORKFLOW.md` §3.3, the rule
/// `PantryRow`/`RecipeCard` already follow).
///
/// `AIProposal` owns the accept/edit/reject STATE TRANSITIONS (computing a
/// new [ProposedField] via [field]'s own `.accept()`/`.edit()`/`.reject()`
/// and handing it to [onChanged]) and the shared visual/warning treatment;
/// it deliberately does NOT render fixed accept/edit/reject buttons of its
/// own, because what "editing" looks like is entirely caller-specific (a
/// `TextField` for a title, a chip row for a role, a list editor for
/// ingredients) — [builder] renders the real interactive content and is
/// handed the three transition callbacks to wire to its own gestures.
class AIProposal<T> extends StatelessWidget {
  const AIProposal({
    super.key,
    required this.field,
    required this.onChanged,
    required this.builder,
    this.warnings = const <String>[],
    this.maxDisplayLength,
    this.semanticsLabel = 'AI-suggested, not yet confirmed',
  });

  final ProposedField<T> field;
  final ValueChanged<ProposedField<T>> onChanged;

  /// Renders the actual interactive content for [field] (its value already
  /// truncated per [maxDisplayLength], if it applies). [onEdit]/[onAccept]/
  /// [onReject] are this widget's own pre-computed state transitions —
  /// call whichever one the caller's own gesture (typing, tapping a chip,
  /// tapping a clear icon) should trigger; none of the three are ever
  /// called automatically.
  final Widget Function(
    BuildContext context,
    ProposedField<T> field,
    ValueChanged<T> onEdit,
    VoidCallback onAccept,
    VoidCallback onReject,
  )
  builder;

  /// Non-blocking notes — rendered as plain informational text, never in
  /// an error style. A draft with warnings is still a usable draft
  /// (E2E_MVP_PLAN.md §13.2.5 D4's own framing, carried through to the
  /// widget that displays it).
  final List<String> warnings;

  /// Above this length, a `String`-typed [field] value is truncated before
  /// reaching [builder] — a 50,000-character AI/third-party-page string is
  /// a real render problem even though Flutter has no XSS analogue. The
  /// actual bound is enforced server-side (W7 S2); this is defence-in-depth
  /// on the client, not the primary control.
  final int? maxDisplayLength;

  /// Screen-reader label applied only while [field] is an active,
  /// unconfirmed proposal — this is the "visually/semantically distinct"
  /// requirement's actual mechanism (asserted via semantics, not pixels).
  final String semanticsLabel;

  static const Key proposedBadgeKey = Key('ai-proposal-badge');
  static const Key warningsKey = Key('ai-proposal-warnings');

  /// Truncation only ever applies when `T` is actually `String` — the
  /// `value is! String` guard below means the `as T` cast on the next line
  /// can only be reached when `String` satisfies `T`, so it can never throw
  /// for any of this widget's real instantiations (`AIProposal<String>` for
  /// title/description, `AIProposal<int>` for servings, etc. all skip this
  /// branch entirely for their non-`String` values).
  ProposedField<T> get _displayField {
    final int? maxLen = maxDisplayLength;
    final T? value = field.value;
    if (maxLen == null || value is! String || value.length <= maxLen) {
      return field;
    }
    final String truncated = '${value.substring(0, maxLen)}…';
    return field.withValue(truncated as T);
  }

  @override
  Widget build(BuildContext context) {
    final ProposedField<T> displayField = _displayField;
    final bool hasProposal = displayField.hasProposal;

    final Widget content = builder(
      context,
      displayField,
      (T newValue) => onChanged(field.edit(newValue)),
      () => onChanged(field.accept()),
      () => onChanged(field.reject()),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (hasProposal) ...<Widget>[
          const PBadge(
            key: proposedBadgeKey,
            label: 'AI suggests',
            tone: PBadgeTone.info,
          ),
          const SizedBox(height: AppSpacing.s0),
        ],
        if (hasProposal)
          Semantics(
            container: true,
            explicitChildNodes: true,
            label: semanticsLabel,
            child: content,
          )
        else
          content,
        if (warnings.isNotEmpty) _WarningsList(warnings: warnings),
      ],
    );
  }
}

/// Split out purely so [AIProposal.warningsKey] can key the whole list
/// once, rather than needing a distinct key per warning line (which would
/// collide when a draft carries more than one warning).
class _WarningsList extends StatelessWidget {
  const _WarningsList({required this.warnings});

  final List<String> warnings;

  @override
  Widget build(BuildContext context) => Padding(
    key: AIProposal.warningsKey,
    padding: const EdgeInsets.only(top: AppSpacing.s0),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: warnings
          .map(
            (warning) => Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Icon(
                    Icons.info_outline,
                    size: AppSizing.icon16,
                    color: AppColors.inkMid,
                  ),
                  const SizedBox(width: AppSpacing.s0),
                  Expanded(
                    child: Text(
                      warning,
                      style: AppTypography.label.copyWith(
                        color: AppColors.inkMid,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(growable: false),
    ),
  );
}
