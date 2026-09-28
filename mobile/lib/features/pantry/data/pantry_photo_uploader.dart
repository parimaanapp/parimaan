import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../../shared/errors/app_error.dart';

/// The raw `PUT` of one compressed photo to the presigned S3 URL that
/// `getPantryPhotoUploadUrl` returned (W20 S5). Deliberately NOT routed
/// through the Ferry GraphQL client — this is plain HTTP to S3, the same
/// separation `shopping_list_share_image_screen.dart`'s W17 backup upload
/// makes. Behind an interface so the repository's ordering is testable
/// without a network.
abstract interface class PantryPhotoUploader {
  /// Completes on any 2xx; throws [PhotoUploadError] otherwise.
  Future<void> put(String presignedUrl, Uint8List jpegBytes);
}

/// User-safe copy, fixed by construction. The presigned URL is a credential
/// (its query string IS the signature), so neither it nor S3's response body
/// is ever interpolated into a message, an exception, or a log line here.
const String _uploadFailedMessage =
    'Could not upload the photo. Check your connection and try again.';

class HttpPantryPhotoUploader implements PantryPhotoUploader {
  HttpPantryPhotoUploader({
    http.Client? client,
    this.timeout = const Duration(seconds: 30),
  }) : _client = client ?? http.Client();

  final http.Client _client;

  /// A stalled upload must end in an error the user can retry, not a spinner
  /// that never resolves. 30s comfortably covers a ≤500KB JPEG on a poor
  /// mobile connection.
  final Duration timeout;

  @override
  Future<void> put(String presignedUrl, Uint8List jpegBytes) async {
    try {
      final http.Response response = await _client
          .put(
            Uri.parse(presignedUrl),
            // The URL was signed for exactly this header (server-side
            // `presignPantryPhotoUpload` signs Content-Type); any other value
            // makes S3 reject the PUT with a signature mismatch.
            headers: const <String, String>{'Content-Type': 'image/jpeg'},
            body: jpegBytes,
          )
          .timeout(timeout);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const PhotoUploadError(_uploadFailedMessage);
      }
    } on PhotoUploadError {
      rethrow;
    } on Object {
      // http.ClientException, SocketException, TimeoutException, a malformed
      // URL — all "the photo did not get there". The cause is dropped on
      // purpose: it can carry the URL.
      throw const PhotoUploadError(_uploadFailedMessage);
    }
  }
}

final Provider<PantryPhotoUploader> pantryPhotoUploaderProvider =
    Provider<PantryPhotoUploader>((Ref ref) => HttpPantryPhotoUploader());
