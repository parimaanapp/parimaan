import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../data/pantry_photo_repository.dart';
import '../domain/pantry_photo_analysis.dart';

/// Where one photo is in the capture -> upload -> analyze pipeline (W20 S5).
/// A sealed hierarchy rather than an `AsyncValue`: the loading state needs a
/// PHASE ("Uploading…" vs "Analyzing…") over a wait that can reach ~25s, and
/// `AsyncLoading` carries none.
sealed class PantryPhotoAnalysisState {
  const PantryPhotoAnalysisState();
}

final class PhotoAnalysisIdle extends PantryPhotoAnalysisState {
  const PhotoAnalysisIdle();
}

final class PhotoAnalysisInProgress extends PantryPhotoAnalysisState {
  const PhotoAnalysisInProgress(this.phase);
  final PhotoAnalysisPhase phase;
}

final class PhotoAnalysisReady extends PantryPhotoAnalysisState {
  const PhotoAnalysisReady(this.analysis);
  final PantryPhotoAnalysis analysis;
}

final class PhotoAnalysisFailed extends PantryPhotoAnalysisState {
  const PhotoAnalysisFailed(this.error);
  final AppError error;

  /// Whether sending the SAME photo again can plausibly help. Deliberately
  /// narrow: a daily-limit hit, a photo the server rejected (retake it, don't
  /// resend it), a forbidden key, or an answer the model cannot produce are
  /// not fixed by a retry — the screen should offer "retake" / "add
  /// manually" instead of a button that fails the same way.
  bool get canRetry => switch (error) {
    PhotoUploadError() ||
    AiTimeoutError() ||
    AiBusyError() ||
    NotFoundError() ||
    InternalError() => true,
    _ => false,
  };
}

/// Client-side cap on the whole pipeline. Ferry has no request timeout of its
/// own, and the server's vision deadline is 24s inside a 28s Lambda and
/// AppSync's 30s ceiling — so 40s means "the server had its full chance and
/// nothing came back", e.g. a stalled connection, and ends in a retryable
/// error instead of an endless spinner. Overridable for tests.
final Provider<Duration> photoAnalysisTimeoutProvider = Provider<Duration>(
  (Ref ref) => const Duration(seconds: 40),
);

class PantryPhotoAnalysisController
    extends AutoDisposeNotifier<PantryPhotoAnalysisState> {
  Uint8List? _photo;

  /// Bumped by [reset]; a result that lands for an older generation is
  /// dropped, so a user who backed out never sees a late answer resurface.
  int _generation = 0;

  @override
  PantryPhotoAnalysisState build() {
    // The photo is a picture of someone's kitchen; don't keep it in memory
    // past this controller's life.
    ref.onDispose(() => _photo = null);
    return const PhotoAnalysisIdle();
  }

  PantryPhotoRepository get _repository =>
      ref.read(pantryPhotoRepositoryProvider);

  /// Analyzes [jpegBytes]. Ignored while a photo is already in flight, so a
  /// double-tap cannot spend two of the day's 20 analyses.
  Future<void> analyze(Uint8List jpegBytes) async {
    if (state is PhotoAnalysisInProgress) {
      return;
    }
    _photo = jpegBytes;
    final int generation = ++_generation;
    state = const PhotoAnalysisInProgress(PhotoAnalysisPhase.uploading);

    PantryPhotoAnalysisState outcome;
    try {
      final PantryPhotoAnalysis analysis = await _repository
          .analyze(
            jpegBytes,
            onPhase: (PhotoAnalysisPhase phase) {
              if (generation == _generation) {
                state = PhotoAnalysisInProgress(phase);
              }
            },
          )
          .timeout(ref.read(photoAnalysisTimeoutProvider));
      outcome = PhotoAnalysisReady(analysis);
    } on AppError catch (error) {
      outcome = PhotoAnalysisFailed(error);
    } on TimeoutException {
      outcome = const PhotoAnalysisFailed(
        AiTimeoutError(
          'This is taking longer than expected. Please try again.',
        ),
      );
    } on Object {
      // Never surface an unexpected exception's text — it can carry a URL.
      outcome = const PhotoAnalysisFailed(InternalError(genericErrorMessage));
    }

    if (generation == _generation) {
      state = outcome;
    }
  }

  /// Re-runs the whole pipeline with the same photo, when a retry can help.
  Future<void> retry() async {
    final PantryPhotoAnalysisState current = state;
    final Uint8List? photo = _photo;
    if (current is! PhotoAnalysisFailed || !current.canRetry || photo == null) {
      return;
    }
    await analyze(photo);
  }

  /// Back to idle, forgetting the photo. Any in-flight result is dropped.
  void reset() {
    _generation++;
    _photo = null;
    state = const PhotoAnalysisIdle();
  }
}

final AutoDisposeNotifierProvider<
  PantryPhotoAnalysisController,
  PantryPhotoAnalysisState
>
pantryPhotoAnalysisControllerProvider =
    NotifierProvider.autoDispose<
      PantryPhotoAnalysisController,
      PantryPhotoAnalysisState
    >(PantryPhotoAnalysisController.new);
