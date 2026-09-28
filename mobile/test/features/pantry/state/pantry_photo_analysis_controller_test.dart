import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_photo_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/features/pantry/state/pantry_photo_analysis_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_pantry_photo_repository.dart';

final Uint8List _photoA = Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 1]);
final Uint8List _photoB = Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 2]);

final PantryPhotoAnalysis _analysis = PantryPhotoAnalysis(
  items: <PantryPhotoProposal>[
    PantryPhotoProposal(name: 'Toor Dal', quantity: 1, unit: 'jar', category: 'dal', confidence: ProposalConfidence.high, warnings: <String>[]),
  ],
  droppedCount: 0,
  truncated: false,
);

({ProviderContainer container, FakePantryPhotoRepository repository, List<PantryPhotoAnalysisState> states}) _subject({Duration timeout = const Duration(seconds: 40)}) {
  final FakePantryPhotoRepository repository = FakePantryPhotoRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: [
      pantryPhotoRepositoryProvider.overrideWithValue(repository),
      photoAnalysisTimeoutProvider.overrideWithValue(timeout),
    ],
  );
  addTearDown(container.dispose);
  final List<PantryPhotoAnalysisState> states = <PantryPhotoAnalysisState>[];
  container.listen<PantryPhotoAnalysisState>(pantryPhotoAnalysisControllerProvider, (_, PantryPhotoAnalysisState next) => states.add(next), fireImmediately: true);
  return (container: container, repository: repository, states: states);
}

PantryPhotoAnalysisController _controller(ProviderContainer c) => c.read(pantryPhotoAnalysisControllerProvider.notifier);

void main() {
  test('starts idle', () {
    final s = _subject();
    expect(s.states.single, isA<PhotoAnalysisIdle>());
  });

  test('a successful photo walks idle -> uploading -> analyzing -> ready, with the analysis', () async {
    final s = _subject();
    s.repository.succeedWith(_analysis);

    await _controller(s.container).analyze(_photoA);

    expect(s.states.map((PantryPhotoAnalysisState e) => e.runtimeType).toList(), <Type>[
      PhotoAnalysisIdle, PhotoAnalysisInProgress, PhotoAnalysisInProgress, PhotoAnalysisInProgress, PhotoAnalysisReady,
    ]);
    final List<PhotoAnalysisPhase?> phases = s.states.whereType<PhotoAnalysisInProgress>().map((PhotoAnalysisInProgress e) => e.phase).toList();
    expect(phases, containsAllInOrder(<PhotoAnalysisPhase>[PhotoAnalysisPhase.uploading, PhotoAnalysisPhase.analyzing]));
    expect((s.states.last as PhotoAnalysisReady).analysis, _analysis);
    expect(s.repository.calls.single, _photoA);
  });

  group('failures', () {
    for (final (String label, AppError error, bool canRetry) in <(String, AppError, bool)>[
      ('an upload failure', const PhotoUploadError('Could not upload the photo.'), true),
      ('an AI timeout', const AiTimeoutError('slow'), true),
      ('AI busy', const AiBusyError('busy'), true),
      ('a photo the server could not find', const NotFoundError('gone'), true),
      ('a connection failure', const InternalError('Could not reach the server.'), true),
      ('the daily limit — retrying today is pointless', const RateLimitedError('limit'), false),
      ('a rejected photo — retake, do not resend the same bytes', const ValidationError('bad photo'), false),
      ('a forbidden key', const ForbiddenError('no'), false),
      ('AI unavailable', const AiUnavailableError('down'), false),
      ('an unparseable answer', const AiUnparseableError('junk'), false),
    ]) {
      test('$label lands on failed, with canRetry=$canRetry', () async {
        final s = _subject();
        s.repository.failWith(error);

        await _controller(s.container).analyze(_photoA);

        final PhotoAnalysisFailed failed = s.states.last as PhotoAnalysisFailed;
        expect(failed.error, error);
        expect(failed.canRetry, canRetry);
      });
    }

    test('an unexpected exception becomes a generic InternalError — its text never reaches the user', () async {
      final s = _subject();
      s.repository.failWith(StateError('secret internal detail'));

      await _controller(s.container).analyze(_photoA);

      final PhotoAnalysisFailed failed = s.states.last as PhotoAnalysisFailed;
      expect(failed.error, isA<InternalError>());
      expect(failed.error.errorMessage, isNot(contains('secret')));
    });
  });

  group('retry', () {
    test('re-runs the whole pipeline with the SAME bytes and can succeed on the second attempt', () async {
      final s = _subject();
      s.repository.failWith(const AiTimeoutError('slow'));
      s.repository.succeedWith(_analysis);
      final PantryPhotoAnalysisController c = _controller(s.container);

      await c.analyze(_photoA);
      await c.retry();

      expect(s.repository.calls, <Uint8List>[_photoA, _photoA]);
      expect(s.states.last, isA<PhotoAnalysisReady>());
    });

    test('does nothing for a failure that a retry cannot fix', () async {
      final s = _subject();
      s.repository.failWith(const RateLimitedError('limit'));
      final PantryPhotoAnalysisController c = _controller(s.container);

      await c.analyze(_photoA);
      await c.retry();

      expect(s.repository.calls, hasLength(1));
      expect(s.states.last, isA<PhotoAnalysisFailed>());
    });

    test('does nothing when there is nothing to retry (idle)', () async {
      final s = _subject();
      await _controller(s.container).retry();
      expect(s.repository.calls, isEmpty);
    });
  });

  test('a second analyze while one is in flight is ignored — a double-tap must not spend two analyses', () async {
    final s = _subject();
    final Completer<PantryPhotoAnalysis> gate = s.repository.hold();
    final PantryPhotoAnalysisController c = _controller(s.container);

    final Future<void> first = c.analyze(_photoA);
    await c.analyze(_photoB);
    gate.complete(_analysis);
    await first;

    expect(s.repository.calls, <Uint8List>[_photoA]);
  });

  test('a stalled analysis times out into an AiTimeoutError instead of spinning forever', () async {
    final s = _subject(timeout: const Duration(milliseconds: 40));
    s.repository.hold();

    await _controller(s.container).analyze(_photoA);

    final PhotoAnalysisFailed failed = s.states.last as PhotoAnalysisFailed;
    expect(failed.error, isA<AiTimeoutError>());
    expect(failed.canRetry, isTrue);
  });

  group('reset', () {
    test('returns to idle and ignores a result that lands afterwards — the user backed out', () async {
      final s = _subject();
      final Completer<PantryPhotoAnalysis> gate = s.repository.hold();
      final PantryPhotoAnalysisController c = _controller(s.container);

      final Future<void> pending = c.analyze(_photoA);
      c.reset();
      gate.complete(_analysis);
      await pending;

      expect(s.states.last, isA<PhotoAnalysisIdle>());
    });

    test('forgets the photo, so a later retry cannot resend what the user abandoned', () async {
      final s = _subject();
      s.repository.failWith(const AiTimeoutError('slow'));
      final PantryPhotoAnalysisController c = _controller(s.container);

      await c.analyze(_photoA);
      c.reset();
      await c.retry();

      expect(s.repository.calls, hasLength(1));
    });

    test('a new photo can be analyzed after a finished one (the "add another shelf" loop)', () async {
      final s = _subject();
      s.repository.succeedWith(_analysis);
      s.repository.succeedWith(_analysis);
      final PantryPhotoAnalysisController c = _controller(s.container);

      await c.analyze(_photoA);
      await c.analyze(_photoB);

      expect(s.repository.calls, <Uint8List>[_photoA, _photoB]);
    });
  });
}
