import 'dart:async';
import 'dart:typed_data';

import 'package:mobile/features/pantry/data/pantry_photo_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';

/// Hand-written [PantryPhotoRepository] double — same rationale as
/// `fake_pantry_repository.dart`: explicit control over WHEN a call completes
/// (the loading-phase requirement), which a `mocktail` stub makes awkward.
/// Each `analyze` call consumes the next scripted outcome; a call with none
/// left throws, so a test that under-scripts fails loudly instead of hanging.
class FakePantryPhotoRepository implements PantryPhotoRepository {
  final List<Object> _outcomes = <Object>[];
  final List<Completer<PantryPhotoAnalysis>> _gates =
      <Completer<PantryPhotoAnalysis>>[];

  /// Every byte buffer `analyze` was called with, in order.
  final List<Uint8List> calls = <Uint8List>[];

  /// Phases this fake reports before settling, in order.
  List<PhotoAnalysisPhase> phases = const <PhotoAnalysisPhase>[
    PhotoAnalysisPhase.uploading,
    PhotoAnalysisPhase.analyzing,
  ];

  /// Script the next call to succeed with [analysis].
  void succeedWith(PantryPhotoAnalysis analysis) => _outcomes.add(analysis);

  /// Script the next call to fail with [error].
  void failWith(Object error) => _outcomes.add(_Failure(error));

  /// Script the next call to stay pending until [complete]/[fail] is called on the returned gate.
  Completer<PantryPhotoAnalysis> hold() {
    final Completer<PantryPhotoAnalysis> gate =
        Completer<PantryPhotoAnalysis>();
    _gates.add(gate);
    _outcomes.add(gate);
    return gate;
  }

  @override
  Future<PantryPhotoAnalysis> analyze(
    Uint8List jpegBytes, {
    void Function(PhotoAnalysisPhase phase)? onPhase,
  }) async {
    calls.add(jpegBytes);
    if (_outcomes.isEmpty) {
      throw StateError(
        'FakePantryPhotoRepository: no scripted outcome left for call #${calls.length}.',
      );
    }
    for (final PhotoAnalysisPhase phase in phases) {
      onPhase?.call(phase);
    }
    final Object next = _outcomes.removeAt(0);
    if (next is Completer<PantryPhotoAnalysis>) {
      return next.future;
    }
    if (next is _Failure) {
      throw next.error;
    }
    return next as PantryPhotoAnalysis;
  }
}

class _Failure {
  const _Failure(this.error);
  final Object error;
}
