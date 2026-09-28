import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/motion.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/pantry_category.dart';
import '../domain/pantry_item_draft.dart';
import '../domain/pantry_photo_analysis.dart';
import '../domain/photo_review_session.dart';
import '../state/pantry_form_controller.dart';
import '../state/photo_review_session_controller.dart';
import 'pantry_error_copy.dart';
import 'photo_analysis_failure_copy.dart';
import 'photo_dead_end.dart';
import 'photo_item_edit_sheet.dart';

/// Flow 9, frame 9.4 (W20 S6): "here's what I think is on your shelf — you
/// decide". Nothing is written until the user confirms; every row can be
/// ticked, edited or removed first, and the low-confidence ones start unticked.
///
/// Copy and layout follow wireframe 9.4: the "◆ N items proposed" badge, the
/// "Nothing is added until you say so." line, and a text tag per row
/// ("✓ ok" / "check" / "guess") so confidence never rests on colour alone.
class PantryPhotoReviewScreen extends ConsumerStatefulWidget {
  const PantryPhotoReviewScreen({
    super.key,
    required this.householdId,
    required this.onAddAnotherShelf,
    required this.onAddManually,
    required this.onCancel,
    required this.onDone,
  });

  final String householdId;

  /// Back to the camera; the session (and this review's items) is kept.
  final VoidCallback onAddAnotherShelf;
  final VoidCallback onAddManually;

  /// The user discarded the review. The session has already been cleared.
  final VoidCallback onCancel;

  /// The items were added; receives how many.
  final ValueChanged<int> onDone;

  static const Key addAnotherShelfKey = Key('photo-review-add-another');
  static const Key confirmKey = Key('photo-review-confirm');
  static const Key cancelKey = Key('photo-review-cancel');
  static const Key errorBannerKey = Key('photo-review-error');
  static const Key discardConfirmKey = Key('photo-review-discard-confirm');
  static const Key keepReviewingKey = Key('photo-review-keep');
  static const Key truncatedNoteKey = Key('photo-review-truncated');
  static Key rowKey(String id) => Key('photo-review-row-$id');
  static Key checkKey(String id) => Key('photo-review-check-$id');

  @override
  ConsumerState<PantryPhotoReviewScreen> createState() =>
      _PantryPhotoReviewScreenState();
}

class _PantryPhotoReviewScreenState
    extends ConsumerState<PantryPhotoReviewScreen> {
  bool _saving = false;
  String? _error;

  PhotoReviewSessionController get _session =>
      ref.read(photoReviewSessionControllerProvider.notifier);

  Future<void> _confirm() async {
    final PhotoReviewSession session = ref.read(
      photoReviewSessionControllerProvider,
    );
    if (_saving || !session.canConfirm) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final List<PantryItemDraft> drafts = session.toDrafts();
    final bool added = await ref
        .read(pantryFormControllerProvider.notifier)
        .bulkAddDrafts(widget.householdId, drafts);
    if (!mounted) {
      return;
    }
    if (added) {
      _session.clear();
      widget.onDone(drafts.length);
      return;
    }
    setState(() {
      _saving = false;
      _error =
          pantryErrorMessage(ref.read(pantryFormControllerProvider).error) ??
          "Couldn't add these just now. Your review is still here — try again.";
    });
  }

  Future<void> _cancel() async {
    final PhotoReviewSession session = ref.read(
      photoReviewSessionControllerProvider,
    );
    if (session.items.isEmpty) {
      _session.clear();
      widget.onCancel();
      return;
    }
    final bool? discard = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        backgroundColor: AppColors.paper,
        title: Text('Discard this review?', style: AppTypography.title),
        content: Text(
          'Nothing has been added to your pantry.',
          style: AppTypography.body,
        ),
        actions: <Widget>[
          PButton(
            key: PantryPhotoReviewScreen.keepReviewingKey,
            label: 'Keep reviewing',
            variant: PButtonVariant.ghost,
            onPressed: () => Navigator.of(context).pop(false),
          ),
          PButton(
            key: PantryPhotoReviewScreen.discardConfirmKey,
            label: 'Discard',
            variant: PButtonVariant.destructive,
            onPressed: () => Navigator.of(context).pop(true),
          ),
        ],
      ),
    );
    if (discard == true && mounted) {
      _session.clear();
      widget.onCancel();
    }
  }

  Future<void> _edit(PhotoReviewItem item) async {
    final PhotoItemEditResult? result = await showPhotoItemEditSheet(
      context,
      item.proposal,
    );
    switch (result) {
      case PhotoItemEdited(:final PantryPhotoProposal proposal):
        _session.edit(item.id, proposal);
      case PhotoItemRemoved():
        _session.remove(item.id);
      case null:
        break;
    }
  }

  void _onDeadEndAction(PhotoFailureAction action) {
    switch (action) {
      case PhotoFailureAction.addManually:
        _session.clear();
        widget.onAddManually();
      case PhotoFailureAction.retake || PhotoFailureAction.retry:
        widget.onAddAnotherShelf();
    }
  }

  @override
  Widget build(BuildContext context) {
    final PhotoReviewSession session = ref.watch(
      photoReviewSessionControllerProvider,
    );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop) {
          unawaited(_cancel());
        }
      },
      child: Scaffold(
        backgroundColor: AppColors.paper,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              PTopBar(
                title: 'Review',
                onBack: () => unawaited(_cancel()),
                backSemanticLabel: 'Back',
              ),
              Expanded(
                child: session.items.isEmpty
                    ? PhotoDeadEnd(
                        copy: emptyPhotoCopy,
                        onAction: _onDeadEndAction,
                      )
                    : _ReviewList(
                        session: session,
                        onToggle: _session.toggle,
                        onEdit: _edit,
                      ),
              ),
              if (session.items.isNotEmpty)
                _ActionBar(
                  session: session,
                  saving: _saving,
                  error: _error,
                  onConfirm: _confirm,
                  onCancel: () => unawaited(_cancel()),
                  onAddAnotherShelf: widget.onAddAnotherShelf,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReviewList extends StatelessWidget {
  const _ReviewList({
    required this.session,
    required this.onToggle,
    required this.onEdit,
  });

  final PhotoReviewSession session;
  final ValueChanged<String> onToggle;
  final ValueChanged<PhotoReviewItem> onEdit;

  @override
  Widget build(BuildContext context) {
    final int n = session.items.length;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.s3,
        AppSpacing.s1,
        AppSpacing.s3,
        AppSpacing.s3,
      ),
      children: <Widget>[
        Align(
          alignment: Alignment.centerLeft,
          child: PBadge(
            label: '◆ $n ${n == 1 ? 'item' : 'items'} proposed',
            tone: PBadgeTone.warning,
          ),
        ),
        const SizedBox(height: AppSpacing.s1),
        Text(
          'Nothing is added until you say so.',
          style: AppTypography.body.copyWith(color: AppColors.inkMid),
        ),
        if (session.truncated) ...<Widget>[
          const SizedBox(height: AppSpacing.s1),
          Text(
            'That shelf had a lot on it — showing the first 40. Take another photo for the rest.',
            key: PantryPhotoReviewScreen.truncatedNoteKey,
            style: AppTypography.body.copyWith(color: AppColors.inkSoft),
          ),
        ],
        const SizedBox(height: AppSpacing.s2),
        for (int i = 0; i < session.items.length; i++) ...<Widget>[
          _EnterRow(
            key: ValueKey<String>(session.items[i].id),
            index: i,
            child: _ReviewRow(
              item: session.items[i],
              onToggle: () => onToggle(session.items[i].id),
              onEdit: () => onEdit(session.items[i]),
            ),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
      ],
    );
  }
}

/// Rows settle in with a short fade-and-rise, staggered (frame 9.4's
/// "160ms emphasized"); skipped when the OS asks for reduced motion.
class _EnterRow extends StatelessWidget {
  const _EnterRow({super.key, required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) {
      return child;
    }
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration:
          AppMotion.quick +
          Duration(milliseconds: 30 * (index < 6 ? index : 6)),
      curve: AppMotion.easeEmphasized,
      builder: (BuildContext context, double t, Widget? child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, 8 * (1 - t)),
          child: child,
        ),
      ),
      child: child,
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({
    required this.item,
    required this.onToggle,
    required this.onEdit,
  });

  final PhotoReviewItem item;
  final VoidCallback onToggle;
  final VoidCallback onEdit;

  static String _tag(ProposalConfidence c) => switch (c) {
    ProposalConfidence.high => '✓ ok',
    ProposalConfidence.medium => 'check',
    ProposalConfidence.low => 'guess',
  };

  static String _spokenConfidence(ProposalConfidence c) => switch (c) {
    ProposalConfidence.high => 'read from the label',
    ProposalConfidence.medium => 'worth a check',
    ProposalConfidence.low => 'a guess',
  };

  String get _amount {
    final double? q = item.proposal.quantity;
    final String? unit = item.proposal.unit;
    if (q == null || unit == null) {
      return '';
    }
    final String number = q == q.roundToDouble()
        ? q.toInt().toString()
        : q.toString();
    return '$number $unit';
  }

  @override
  Widget build(BuildContext context) {
    final PantryPhotoProposal p = item.proposal;
    final bool confident = p.confidence == ProposalConfidence.high;
    final bool needsAmount = item.selected && !item.isComplete;
    final List<String> notes = <String>[
      if (item.duplicateNote != null) item.duplicateNote!,
      ...p.warnings,
    ];
    final String detail = <String>[
      if (_amount.isNotEmpty) _amount,
      pantryCategoryLabel(p.category),
    ].join(' · ');

    return Semantics(
      container: true,
      label:
          '${p.name}, ${_amount.isEmpty ? 'no amount' : _amount}, ${_spokenConfidence(p.confidence)}, '
          '${item.selected ? 'will be added' : 'will not be added'}',
      child: Material(
        key: PantryPhotoReviewScreen.rowKey(item.id),
        color: confident ? AppColors.cardamomSoft : AppColors.haldiSoft,
        borderRadius: AppRadius.borderM,
        child: Row(
          children: <Widget>[
            InkWell(
              key: PantryPhotoReviewScreen.checkKey(item.id),
              onTap: onToggle,
              borderRadius: AppRadius.borderM,
              child: SizedBox(
                width: 52,
                height: 52,
                child: Icon(
                  item.selected
                      ? Icons.check_box
                      : Icons.check_box_outline_blank,
                  color: item.selected ? AppColors.cardamom : AppColors.inkSoft,
                  semanticLabel: item.selected ? 'Included' : 'Not included',
                ),
              ),
            ),
            Expanded(
              child: InkWell(
                onTap: onEdit,
                borderRadius: AppRadius.borderM,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.s2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(p.name, style: AppTypography.bodyStrong),
                      Text(
                        detail,
                        style: AppTypography.mono.copyWith(
                          color: AppColors.inkSoft,
                        ),
                      ),
                      for (final String note in notes)
                        Text(
                          note,
                          style: AppTypography.meta.copyWith(
                            color: AppColors.inkSoft,
                          ),
                        ),
                      if (needsAmount)
                        Text(
                          'Needs an amount — tap to add',
                          style: AppTypography.meta.copyWith(
                            color: AppColors.terracottaDeep,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2),
              child: Text(
                _tag(p.confidence),
                style: AppTypography.meta.copyWith(
                  color: confident
                      ? AppColors.cardamomSoftForeground
                      : AppColors.inkSoft,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.session,
    required this.saving,
    required this.error,
    required this.onConfirm,
    required this.onCancel,
    required this.onAddAnotherShelf,
  });

  final PhotoReviewSession session;
  final bool saving;
  final String? error;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;
  final VoidCallback onAddAnotherShelf;

  String? get _hint {
    if (session.overBulkCap) {
      return 'That’s more than $photoReviewBulkCap at once — untick a few and add the rest after.';
    }
    if (session.selectedCount > 0 && !session.allSelectedComplete) {
      return 'Add an amount to the items marked above.';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final int count = session.selectedCount;
    final String? hint = _hint;
    return Container(
      color: AppColors.paper,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.s3,
        AppSpacing.s1,
        AppSpacing.s3,
        AppSpacing.s2,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s1),
              child: Text(
                error!,
                key: PantryPhotoReviewScreen.errorBannerKey,
                style: AppTypography.body.copyWith(color: AppColors.danger),
              ),
            ),
          if (hint != null)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.s1),
              child: Text(
                hint,
                style: AppTypography.meta.copyWith(color: AppColors.inkSoft),
              ),
            ),
          PButton(
            key: PantryPhotoReviewScreen.addAnotherShelfKey,
            label: '＋ Add another shelf',
            variant: PButtonVariant.ghost,
            expand: true,
            onPressed: saving ? null : onAddAnotherShelf,
          ),
          const SizedBox(height: AppSpacing.s1),
          Row(
            children: <Widget>[
              Expanded(
                child: PButton(
                  key: PantryPhotoReviewScreen.cancelKey,
                  label: 'Cancel',
                  variant: PButtonVariant.secondary,
                  onPressed: saving ? null : onCancel,
                ),
              ),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                flex: 2,
                child: PButton(
                  key: PantryPhotoReviewScreen.confirmKey,
                  label: count == 0
                      ? 'Add items'
                      : 'Add $count ${count == 1 ? 'item' : 'items'}',
                  variant: PButtonVariant.affirmative,
                  isLoading: saving,
                  onPressed: session.canConfirm ? onConfirm : null,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
