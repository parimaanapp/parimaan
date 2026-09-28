import 'dart:typed_data';

import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/pantry/data/pantry_photo_repository.dart';
import 'package:mobile/features/pantry/data/pantry_photo_uploader.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';

final Uint8List _jpeg = Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 1, 2, 3]);
const String _url = 'https://uploads.test/pantry-photos/sub/id.jpg?X-Amz-Signature=abc';
const String _key = 'pantry-photos/sub/id.jpg';

class _RecordingUploader implements PantryPhotoUploader {
  _RecordingUploader(this.log, {this.error});
  final List<String> log;
  final Object? error;
  final List<({String url, Uint8List bytes})> puts = <({String url, Uint8List bytes})>[];

  @override
  Future<void> put(String url, Uint8List jpegBytes) async {
    log.add('put');
    puts.add((url: url, bytes: jpegBytes));
    if (error != null) throw error!;
  }
}

Map<String, dynamic> _analysisBody(List<Map<String, dynamic>> items, {int dropped = 0, bool truncated = false}) => <String, dynamic>{
  'data': <String, dynamic>{
    'analyzePantryPhoto': <String, dynamic>{
      '__typename': 'PantryPhotoAnalysis',
      'items': items,
      'droppedCount': dropped,
      'truncated': truncated,
    },
  },
};

Map<String, dynamic> _item(String name, {double? quantity = 1, String? unit = 'jar', String category = 'dal', String confidence = 'high', List<String> warnings = const <String>[]}) =>
    <String, dynamic>{
      '__typename': 'PantryPhotoProposal',
      'name': name, 'quantity': quantity, 'unit': unit, 'category': category, 'confidence': confidence, 'warnings': warnings,
    };

Map<String, dynamic> _errorBody(String errorType, String message) => <String, dynamic>{
  'data': null,
  'errors': <dynamic>[<String, dynamic>{'path': <String>['fetch'], 'errorType': errorType, 'message': message}],
};

({FerryPantryPhotoRepository repository, FakeLink link, List<String> log, _RecordingUploader uploader}) _subject({
  Map<String, dynamic> Function(Request request)? analyze,
  Object? uploadError,
  Map<String, dynamic> Function(Request request)? uploadUrl,
}) {
  final List<String> log = <String>[];
  final FakeLink link = FakeLink((Request request) {
    final String op = request.operation.operationName ?? '';
    log.add(op);
    if (op == 'GetPantryPhotoUploadUrl') {
      return (uploadUrl ?? (Request _) => <String, dynamic>{'data': <String, dynamic>{'getPantryPhotoUploadUrl': <String, dynamic>{'__typename': 'PresignedUpload', 'url': _url, 's3Key': _key}}})(request);
    }
    return (analyze ?? (Request _) => _analysisBody(<Map<String, dynamic>>[_item('Toor Dal')]))(request);
  });
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  final _RecordingUploader uploader = _RecordingUploader(log, error: uploadError);
  return (repository: FerryPantryPhotoRepository(client: client, uploader: uploader), link: link, log: log, uploader: uploader);
}

void main() {
  group('FerryPantryPhotoRepository.analyze — the pipeline', () {
    test('runs URL -> PUT -> analyze, in that order, and each step uses the previous one\'s output', () async {
      final s = _subject();
      await s.repository.analyze(_jpeg);

      expect(s.log, <String>['GetPantryPhotoUploadUrl', 'put', 'AnalyzePantryPhoto']);
      expect(s.uploader.puts.single.url, _url);
      expect(s.uploader.puts.single.bytes, _jpeg);
      expect(s.link.requests.last.variables['s3Key'], _key);
    });

    test('reports the two phases in order, so the screen can say "Uploading" then "Analyzing"', () async {
      final s = _subject();
      final List<PhotoAnalysisPhase> phases = <PhotoAnalysisPhase>[];
      await s.repository.analyze(_jpeg, onPhase: phases.add);

      expect(phases, <PhotoAnalysisPhase>[PhotoAnalysisPhase.uploading, PhotoAnalysisPhase.analyzing]);
    });

    test('a failed upload stops the pipeline: analyze is never requested for a photo that is not there', () async {
      final s = _subject(uploadError: const PhotoUploadError('Could not upload the photo.'));

      await expectLater(s.repository.analyze(_jpeg), throwsA(isA<PhotoUploadError>()));
      expect(s.log, <String>['GetPantryPhotoUploadUrl', 'put']);
    });

    test('a failure getting the URL stops before any upload, and keeps its typed error (the 60/day cap)', () async {
      final s = _subject(uploadUrl: (Request _) => _errorBody('RATE_LIMITED', "You've reached today's limit of 60 photo uploads."));

      await expectLater(s.repository.analyze(_jpeg), throwsA(isA<RateLimitedError>()));
      expect(s.uploader.puts, isEmpty);
    });
  });

  group('FerryPantryPhotoRepository.analyze — server errors keep their type', () {
    for (final (String code, Type type) in <(String, Type)>[
      ('RATE_LIMITED', RateLimitedError),
      ('AI_TIMEOUT', AiTimeoutError),
      ('AI_BUSY', AiBusyError),
      ('AI_UNAVAILABLE', AiUnavailableError),
      ('AI_UNPARSEABLE', AiUnparseableError),
      ('NOT_FOUND', NotFoundError),
      ('VALIDATION', ValidationError),
      ('FORBIDDEN', ForbiddenError),
    ]) {
      test('$code surfaces as $type, with the server\'s message intact', () async {
        final s = _subject(analyze: (Request _) => _errorBody(code, 'server says $code'));

        await expectLater(
          s.repository.analyze(_jpeg),
          throwsA(predicate((Object e) => e.runtimeType == type && (e as AppError).errorMessage == 'server says $code')),
        );
      });
    }
  });

  group('FerryPantryPhotoRepository.analyze — mapping to the domain model', () {
    test('maps every field, including nullable quantity/unit and the counts', () async {
      final s = _subject(
        analyze: (Request _) => _analysisBody(
          <Map<String, dynamic>>[
            _item('Toor Dal', quantity: 2, unit: 'jar', category: 'dal', confidence: 'high'),
            _item('Red Powder', quantity: null, unit: null, category: 'spice', confidence: 'low', warnings: <String>['Unit "crate" wasn\'t recognised — please pick one.']),
          ],
          dropped: 3,
          truncated: true,
        ),
      );

      final PantryPhotoAnalysis result = await s.repository.analyze(_jpeg);

      expect(result.droppedCount, 3);
      expect(result.truncated, isTrue);
      expect(result.items, <PantryPhotoProposal>[
        PantryPhotoProposal(name: 'Toor Dal', quantity: 2, unit: 'jar', category: 'dal', confidence: ProposalConfidence.high, warnings: <String>[]),
        PantryPhotoProposal(
          name: 'Red Powder', quantity: null, unit: null, category: 'spice', confidence: ProposalConfidence.low,
          warnings: <String>['Unit "crate" wasn\'t recognised — please pick one.'],
        ),
      ]);
    });

    test('an empty result is a normal success', () async {
      final s = _subject(analyze: (Request _) => _analysisBody(<Map<String, dynamic>>[]));
      final PantryPhotoAnalysis result = await s.repository.analyze(_jpeg);

      expect(result.isEmpty, isTrue);
    });
  });
}
