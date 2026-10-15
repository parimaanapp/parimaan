import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// W19 §26.1 / SD:1274's already-locked spec: every captured pantry photo
/// is downscaled to this many pixels on its longest edge before it ever
/// leaves the device.
const int maxPantryPhotoDimension = 1024;

/// SD:1274's already-locked JPEG quality for the same downscale pass.
const int pantryPhotoJpegQuality = 80;

/// The server-side ceiling (SD §8.5/§11) this compression pass exists to
/// stay under — not enforced here (this function's job is to compress, not
/// to validate against the cap), but named so a caller checking its own
/// output against the real limit has one source for the number rather than
/// a second hardcoded `500 * 1024` somewhere else.
const int pantryPhotoServerSideMaxBytes = 500 * 1024;

/// Decodes [bytes] as an image, downscales it so its longest edge is at
/// most [maxPantryPhotoDimension] (never upscales a smaller source photo —
/// `image`'s own `copyResize` with only one bound set preserves aspect
/// ratio), and re-encodes as JPEG at [pantryPhotoJpegQuality].
///
/// Throws a plain `FormatException` if [bytes] isn't a decodable image —
/// deliberately not a silent pass-through of the original bytes, since a
/// caller receiving what looks like a successfully "compressed" file that
/// is actually just the untouched multi-MB original would be a much worse,
/// harder-to-notice failure than a loud one at capture time.
///
/// `img.decodeImage` itself is not well-behaved on malformed input — found
/// empirically (a hand-written test feeding it 5 garbage bytes), it can
/// throw a raw `RangeError` from deep inside one of its format-sniffing
/// sub-decoders (PSD's header reader, in the case actually hit) rather than
/// cleanly returning `null` the way its own signature implies. Both paths
/// — a `null` result and a thrown decoder-internal error — are normalized
/// to the same `FormatException` here, so a caller has exactly one failure
/// shape to handle regardless of which way the underlying library fails.
Uint8List compressPantryPhoto(Uint8List bytes) {
  img.Image? decoded;
  try {
    decoded = img.decodeImage(bytes);
  } catch (cause) {
    throw FormatException('Could not decode image bytes for pantry photo compression: $cause');
  }
  if (decoded == null) {
    throw const FormatException('Could not decode image bytes for pantry photo compression.');
  }

  final bool needsDownscale =
      decoded.width > maxPantryPhotoDimension || decoded.height > maxPantryPhotoDimension;
  final img.Image resized = needsDownscale
      ? (decoded.width >= decoded.height
            ? img.copyResize(decoded, width: maxPantryPhotoDimension)
            : img.copyResize(decoded, height: maxPantryPhotoDimension))
      : decoded;

  return Uint8List.fromList(img.encodeJpg(resized, quality: pantryPhotoJpegQuality));
}
