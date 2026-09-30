import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/cook_suggestion.dart';
import '../state/cook_suggestions_controller.dart';
import 'cook_dead_end.dart';
import 'cook_failure_copy.dart';

/// Flow 11, frame 11.2 (W21 S5): up to 3 AI-suggested recipes, grounded in
/// the household's real pantry — a normal empty answer (pantry too small,
/// nothing grounded) and every failure share [CookDeadEnd], the same
/// "no dead ends" pattern W20 S6 established for the photo review flow.
class CookSuggestionsScreen extends ConsumerWidget {
  const CookSuggestionsScreen({
    super.key,
    required this.householdId,
    required this.onSelectSuggestion,
    required this.onDifferentVibe,
    required this.onAddManually,
    this.onBack,
  });

  final String householdId;
  final ValueChanged<CookSuggestion> onSelectSuggestion;

  /// "Try a different vibe" from a dead end — the caller decides where that
  /// goes (usually back to the trigger screen, keeping the pantry state).
  final VoidCallback onDifferentVibe;
  final VoidCallback onAddManually;
  final VoidCallback? onBack;

  static const Key loadingKey = Key('cook-suggestions-loading');
  static Key cardKey(String id) => Key('cook-suggestion-card-$id');

  void _onDeadEndAction(CookFailureAction action, WidgetRef ref) {
    switch (action) {
      case CookFailureAction.retry:
        unawaited(
          ref
              .read(cookSuggestionsControllerProvider(householdId).notifier)
              .retry(),
        );
      case CookFailureAction.differentVibe:
        onDifferentVibe();
      case CookFailureAction.addManually:
        onAddManually();
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CookSuggestionsState state = ref.watch(
      cookSuggestionsControllerProvider(householdId),
    );

    final Widget body = switch (state) {
      CookSuggestionsLoading() => const Center(
        key: loadingKey,
        child: CircularProgressIndicator(),
      ),
      // Idle here means no request was ever made — a deep link, a restored
      // route, or back/forward navigation reaching this screen directly,
      // never the normal path (the trigger screen's own `onSuggest` always
      // starts a request before pushing here). There is nothing to show and
      // nothing to wait for, so recover to the trigger screen rather than
      // spin on `loadingKey` forever.
      CookSuggestionsIdle() => Builder(
        builder: (BuildContext context) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => onDifferentVibe(),
          );
          return const Center(
            key: loadingKey,
            child: CircularProgressIndicator(),
          );
        },
      ),
      CookSuggestionsReady(:final result) => _SuggestionsList(
        result: result.suggestions,
        onTap: onSelectSuggestion,
      ),
      CookSuggestionsPantryTooSmall() => CookDeadEnd(
        copy: emptyPantryCopy,
        onAction: (CookFailureAction a) => _onDeadEndAction(a, ref),
      ),
      CookSuggestionsNoGrounded() => CookDeadEnd(
        copy: noGroundedCopy,
        onAction: (CookFailureAction a) => _onDeadEndAction(a, ref),
      ),
      CookSuggestionsFailed(:final error) => CookDeadEnd(
        copy: cookFailureCopy(error),
        onAction: (CookFailureAction a) => _onDeadEndAction(a, ref),
      ),
    };

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Suggestions',
              onBack: onBack ?? () => Navigator.of(context).pop(),
              backSemanticLabel: 'Back',
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}

class _SuggestionsList extends StatelessWidget {
  const _SuggestionsList({required this.result, required this.onTap});

  final List<CookSuggestion> result;
  final ValueChanged<CookSuggestion> onTap;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(AppSpacing.s3),
    children: <Widget>[
      const Align(
        alignment: Alignment.centerLeft,
        child: PBadge(label: '◆ Grounded in pantry', tone: PBadgeTone.accent),
      ),
      const SizedBox(height: AppSpacing.s2),
      for (final CookSuggestion suggestion in result) ...<Widget>[
        _SuggestionCard(suggestion: suggestion, onTap: () => onTap(suggestion)),
        const SizedBox(height: AppSpacing.s2),
      ],
      Text(
        'Save any → joins your recipe library',
        style: AppTypography.meta.copyWith(color: AppColors.inkMid),
      ),
    ],
  );
}

class _SuggestionCard extends StatelessWidget {
  const _SuggestionCard({required this.suggestion, required this.onTap});

  final CookSuggestion suggestion;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: AppColors.card,
    borderRadius: AppRadius.borderM,
    child: InkWell(
      onTap: onTap,
      borderRadius: AppRadius.borderM,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              suggestion.draft.title ?? 'Untitled',
              style: AppTypography.bodyStrong,
            ),
            const SizedBox(height: AppSpacing.s0),
            if (suggestion.have.isNotEmpty)
              _Line(
                label: 'Have',
                value: suggestion.have.join(' · '),
                color: AppColors.cardamom,
              ),
            if (suggestion.missing.isNotEmpty)
              _Line(
                label: 'Missing',
                value: suggestion.missing.join(' · '),
                color: AppColors.danger,
              ),
          ],
        ),
      ),
    ),
  );
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 2),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          '$label: ',
          style: AppTypography.meta.copyWith(
            color: color,
            fontWeight: FontWeight.w600,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: AppTypography.meta.copyWith(color: AppColors.inkSoft),
          ),
        ),
      ],
    ),
  );
}
