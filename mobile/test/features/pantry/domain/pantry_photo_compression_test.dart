import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:mobile/features/pantry/domain/pantry_photo_compression.dart';

Uint8List _fakeJpeg({required int width, required int height}) {
  final img.Image image = img.Image(width: width, height: height);
  img.fill(image, color: img.ColorRgb8(120, 80, 40));
  return Uint8List.fromList(img.encodeJpg(image, quality: 95));
}

void main() {
  group('compressPantryPhoto', () {
    test('downscales a wide photo so its longest edge is exactly 1024px', () {
      final Uint8List source = _fakeJpeg(width: 3024, height: 2016);

      final Uint8List result = compressPantryPhoto(source);
      final img.Image decoded = img.decodeJpg(result)!;

      expect(decoded.width, maxPantryPhotoDimension);
      expect(decoded.height, lessThan(maxPantryPhotoDimension));
    });

    test('downscales a tall photo so its longest edge is exactly 1024px', () {
      final Uint8List source = _fakeJpeg(width: 2016, height: 3024);

      final Uint8List result = compressPantryPhoto(source);
      final img.Image decoded = img.decodeJpg(result)!;

      expect(decoded.height, maxPantryPhotoDimension);
      expect(decoded.width, lessThan(maxPantryPhotoDimension));
    });

    test('never upscales a photo already smaller than the target dimension', () {
      final Uint8List source = _fakeJpeg(width: 400, height: 300);

      final Uint8List result = compressPantryPhoto(source);
      final img.Image decoded = img.decodeJpg(result)!;

      expect(decoded.width, 400);
      expect(decoded.height, 300);
    });

    test('always re-encodes as JPEG, even from a non-JPEG source', () {
      final img.Image image = img.Image(width: 100, height: 100);
      img.fill(image, color: img.ColorRgb8(10, 200, 30));
      final Uint8List pngSource = Uint8List.fromList(img.encodePng(image));

      final Uint8List result = compressPantryPhoto(pngSource);

      expect(img.decodeJpg(result), isNotNull);
    });

    test('throws FormatException on undecodable bytes rather than silently passing them through', () {
      final Uint8List garbage = Uint8List.fromList(<int>[0, 1, 2, 3, 4]);

      expect(() => compressPantryPhoto(garbage), throwsFormatException);
    });
  });
}
