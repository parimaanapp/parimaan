import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile/features/pantry/data/pantry_photo_uploader.dart';
import 'package:mobile/shared/errors/app_error.dart';

final Uint8List _jpeg = Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

void main() {
  group('HttpPantryPhotoUploader', () {
    test('PUTs the exact bytes to the presigned URL with Content-Type image/jpeg — the header the URL was signed for', () async {
      late http.Request seen;
      final HttpPantryPhotoUploader uploader = HttpPantryPhotoUploader(
        client: MockClient((http.Request request) async {
          seen = request;
          return http.Response('', 200);
        }),
      );

      await uploader.put('https://bucket.s3.ap-south-1.amazonaws.com/pantry-photos/a/b.jpg?X-Amz-Signature=x', _jpeg);

      expect(seen.method, 'PUT');
      expect(seen.url.host, 'bucket.s3.ap-south-1.amazonaws.com');
      expect(seen.url.queryParameters['X-Amz-Signature'], 'x');
      expect(seen.headers['Content-Type'], 'image/jpeg');
      expect(seen.bodyBytes, _jpeg);
    });

    test('any 2xx is success', () async {
      final HttpPantryPhotoUploader uploader = HttpPantryPhotoUploader(client: MockClient((_) async => http.Response('', 204)));
      await expectLater(uploader.put('https://x.test/a', _jpeg), completes);
    });

    for (final int status in <int>[400, 403, 500]) {
      test('HTTP $status is a PhotoUploadError, never a silent success', () async {
        final HttpPantryPhotoUploader uploader = HttpPantryPhotoUploader(client: MockClient((_) async => http.Response('denied', status)));
        await expectLater(uploader.put('https://x.test/a', _jpeg), throwsA(isA<PhotoUploadError>()));
      });
    }

    test('a network failure is a PhotoUploadError with retry-oriented copy', () async {
      final HttpPantryPhotoUploader uploader = HttpPantryPhotoUploader(
        client: MockClient((_) async => throw http.ClientException('connection reset')),
      );

      await expectLater(
        uploader.put('https://x.test/a', _jpeg),
        throwsA(isA<PhotoUploadError>().having((PhotoUploadError e) => e.errorMessage, 'message', contains('connection'))),
      );
    });

    test('a stalled upload times out into a PhotoUploadError instead of hanging the screen', () async {
      final HttpPantryPhotoUploader uploader = HttpPantryPhotoUploader(
        client: MockClient((_) => Completer<http.Response>().future),
        timeout: const Duration(milliseconds: 30),
      );

      await expectLater(uploader.put('https://x.test/a', _jpeg), throwsA(isA<PhotoUploadError>()));
    });

    test('never puts server or URL internals in the user-facing message — the presigned URL is a credential', () async {
      const String secretUrl = 'https://x.test/a?X-Amz-Signature=SECRET123';
      final HttpPantryPhotoUploader uploader = HttpPantryPhotoUploader(client: MockClient((_) async => http.Response('SECRET123', 403)));

      try {
        await uploader.put(secretUrl, _jpeg);
        fail('expected a PhotoUploadError');
      } on PhotoUploadError catch (e) {
        expect(e.errorMessage, isNot(contains('SECRET123')));
        expect(e.toString(), isNot(contains('SECRET123')));
      }
    });
  });
}
