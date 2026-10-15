import 'package:flutter/widgets.dart';

/// A bold, drawn left-pointing chevron — the visible glyph of the app's back
/// control. Drawn rather than typeset so its weight and size do not depend on
/// font metrics. Mirrors under right-to-left [Directionality] so it always
/// points toward the "back" side.
class PBackChevron extends StatelessWidget {
  const PBackChevron({
    super.key,
    required this.color,
    this.size = defaultSize,
    this.strokeWidth = defaultStrokeWidth,
  });

  static const double defaultSize = 24;
  static const double defaultStrokeWidth = 2.8;

  final Color color;
  final double size;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(
      size: Size.square(size),
      painter: _ChevronPainter(
        color: color,
        strokeWidth: strokeWidth,
        mirrored: Directionality.of(context) == TextDirection.rtl,
      ),
    ),
  );
}

class _ChevronPainter extends CustomPainter {
  const _ChevronPainter({
    required this.color,
    required this.strokeWidth,
    required this.mirrored,
  });

  final Color color;
  final double strokeWidth;
  final bool mirrored;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    double x(double fraction) =>
        size.width * (mirrored ? 1 - fraction : fraction);
    final Path path = Path()
      ..moveTo(x(0.65), size.height * 0.15)
      ..lineTo(x(0.30), size.height * 0.5)
      ..lineTo(x(0.65), size.height * 0.85);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_ChevronPainter old) =>
      old.color != color ||
      old.strokeWidth != strokeWidth ||
      old.mirrored != mirrored;
}
