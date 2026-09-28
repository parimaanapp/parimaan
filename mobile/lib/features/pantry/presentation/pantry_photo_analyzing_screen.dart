import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/radius.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../data/pantry_photo_repository.dart';
import '../domain/pantry_item.dart';
import '../state/pantry_controller.dart';
import '../state/pantry_photo_analysis_controller.dart';
import '../state/photo_review_session_controller.dart';
import 'photo_analysis_failure_copy.dart';
import 'photo_dead_end.dart';

/// Flow 9, frame 9.3 (W20 S6): the wait between the shutter and the review.
///
/// Sends [photo] on first build, shows it back to the user with the phase in
/// plain words, and hands off to the review as soon as an answer lands. The
/// wait can reach ~25s, so it says what is happening (uploading vs reading)
/// and, past [slowHintAfter], that a slow one is still normal.
class PantryPhotoAnalyzingScreen extends ConsumerStatefulWidget {
  const PantryPhotoAnalyzingScreen({
    super.key,
    required this.photo,
    required this.householdId,
    required this.onReviewReady,
    required this.onRetake,
    required this.onAddManually,
    required this.onCancel,
    this.slowHintAfter = const Duration(seconds: 10),
  });

  final Uint8List photo;
  final String householdId;

  /// The photo produced proposals (now in the review session).
  final VoidCallback onReviewReady;

  /// Back to the camera for another try.
  final VoidCallback onRetake;
  final VoidCallback onAddManually;

  /// The user gave up while waiting.
  final VoidCallback onCancel;

  final Duration slowHintAfter;

  static const Key photoKey = Key('photo-analyzing-photo');
  static const Key cancelKey = Key('photo-analyzing-cancel');
  static const Key slowHintKey = Key('photo-analyzing-slow-hint');
  static const Key phaseKey = Key('photo-analyzing-phase');

  @override
  ConsumerState<PantryPhotoAnalyzingScreen> createState() =>
      _PantryPhotoAnalyzingScreenState();
}

class _PantryPhotoAnalyzingScreenState
    extends ConsumerState<PantryPhotoAnalyzingScreen> {
  Timer? _slowTimer;
  bool _slow = false;
  bool _emptyAnswer = false;

  @override
  void initState() {
    super.initState();
    _slowTimer = Timer(widget.slowHintAfter, () {
      if (mounted) {
        setState(() => _slow = true);
      }
    });
    // After the first frame so the provider isn't mutated during build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(
          ref
              .read(pantryPhotoAnalysisControllerProvider.notifier)
              .analyze(widget.photo),
        );
      }
    });
  }

  @override
  void dispose() {
    _slowTimer?.cancel();
    super.dispose();
  }

  Set<String> _pantryNames() => <String>{
    for (final PantryItem item
        in ref.read(pantryControllerProvider(widget.householdId)).valueOrNull ??
            const <PantryItem>[])
      item.name,
  };

  void _onState(
    PantryPhotoAnalysisState? previous,
    PantryPhotoAnalysisState next,
  ) {
    if (next is! PhotoAnalysisReady) {
      return;
    }
    final PhotoReviewSessionController session = ref.read(
      photoReviewSessionControllerProvider.notifier,
    );
    if (next.analysis.isEmpty &&
        ref.read(photoReviewSessionControllerProvider).items.isEmpty) {
      setState(() => _emptyAnswer = true);
      return;
    }
    session.addAnalysis(next.analysis, pantryNames: _pantryNames());
    if (next.analysis.isEmpty && mounted) {
      // An earlier shelf already has items: say this one gave nothing, keep going.
      PToast.show(
        context: context,
        toast: const PToast(
          message:
              "Couldn't make out that shelf — your other items are still here.",
        ),
        duration: const Duration(seconds: 4),
      );
    }
    widget.onReviewReady();
  }

  void _giveUp() {
    ref.read(pantryPhotoAnalysisControllerProvider.notifier).reset();
    widget.onCancel();
  }

  void _onDeadEndAction(PhotoFailureAction action) {
    final PantryPhotoAnalysisController controller = ref.read(
      pantryPhotoAnalysisControllerProvider.notifier,
    );
    switch (action) {
      case PhotoFailureAction.retry:
        unawaited(controller.retry());
      case PhotoFailureAction.retake:
        controller.reset();
        widget.onRetake();
      case PhotoFailureAction.addManually:
        controller.reset();
        widget.onAddManually();
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<PantryPhotoAnalysisState>(
      pantryPhotoAnalysisControllerProvider,
      _onState,
    );
    final PantryPhotoAnalysisState state = ref.watch(
      pantryPhotoAnalysisControllerProvider,
    );

    final Widget body = switch (state) {
      _ when _emptyAnswer => PhotoDeadEnd(
        copy: emptyPhotoCopy,
        onAction: _onDeadEndAction,
      ),
      PhotoAnalysisFailed(:final error) => PhotoDeadEnd(
        copy: _copyFor(state, error),
        onAction: _onDeadEndAction,
      ),
      _ => _Waiting(
        photo: widget.photo,
        state: state,
        slow: _slow,
        onCancel: _giveUp,
      ),
    };

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Reading your shelf',
              onBack: _giveUp,
              backSemanticLabel: 'Back',
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }

  /// A retry that cannot help is not offered (the controller already knows).
  PhotoFailureCopy _copyFor(PhotoAnalysisFailed state, Object error) {
    final PhotoFailureCopy copy = photoFailureCopy(state.error);
    if (state.canRetry) {
      return copy;
    }
    final List<PhotoFailureAction> actions = copy.actions
        .where((PhotoFailureAction a) => a != PhotoFailureAction.retry)
        .toList();
    return PhotoFailureCopy(
      headline: copy.headline,
      body: copy.body,
      actions: actions,
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting({
    required this.photo,
    required this.state,
    required this.slow,
    required this.onCancel,
  });

  final Uint8List photo;
  final PantryPhotoAnalysisState state;
  final bool slow;
  final VoidCallback onCancel;

  String get _phase => switch (state) {
    PhotoAnalysisInProgress(phase: PhotoAnalysisPhase.analyzing) =>
      'Reading what’s on the shelf…',
    _ => 'Sending the photo…',
  };

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(AppSpacing.s3),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Expanded(
          child: ClipRRect(
            borderRadius: AppRadius.borderL,
            child: Image.memory(
              photo,
              key: PantryPhotoAnalyzingScreen.photoKey,
              fit: BoxFit.cover,
              gaplessPlayback: true,
              semanticLabel: 'The photo of your shelf',
              errorBuilder: (
                BuildContext context,
                Object error,
                StackTrace? stack,
              ) => const ColoredBox(color: AppColors.paper2),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.s3),
        const LinearProgressIndicator(
          minHeight: 4,
          color: AppColors.terracotta,
          backgroundColor: AppColors.paper2,
        ),
        const SizedBox(height: AppSpacing.s2),
        Semantics(
          liveRegion: true,
          child: Text(
            _phase,
            key: PantryPhotoAnalyzingScreen.phaseKey,
            style: AppTypography.displayM,
          ),
        ),
        const SizedBox(height: AppSpacing.s0),
        Text(
          slow
              ? 'Still reading — a busy shelf can take up to half a minute.'
              : 'Nothing is added until you say so.',
          key: slow ? PantryPhotoAnalyzingScreen.slowHintKey : null,
          style: AppTypography.body.copyWith(color: AppColors.inkMid),
        ),
        const SizedBox(height: AppSpacing.s2),
        PButton(
          key: PantryPhotoAnalyzingScreen.cancelKey,
          label: 'Cancel',
          variant: PButtonVariant.ghost,
          expand: true,
          onPressed: onCancel,
        ),
      ],
    ),
  );
}
