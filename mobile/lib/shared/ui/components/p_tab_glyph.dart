import 'package:flutter/widgets.dart';

import '../tokens.dart';

/// The four shapes of the bottom tab bar, drawn rather than typeset.
///
/// They follow the wireframe's placeholder glyphs (◉ ▦ ◈ ☰) so they render
/// identically on every phone instead of depending on a font fallback.
enum PTabGlyph {
  /// ◉ — a ring with a centre dot.
  today,

  /// ▦ — a rounded square divided into a grid.
  plan,

  /// ◈ — a box (cube) seen from above.
  pantry,

  /// ☰ / book — an open book.
  recipes,
}

/// Draws a [PTabGlyph] in a single [color] at [size] x [size].
///
/// Decorative: the owning tab carries the label and selection semantics, so
/// this widget excludes itself from the semantics tree.
class PTabGlyphIcon extends StatelessWidget {
  const PTabGlyphIcon({
    super.key,
    required this.glyph,
    required this.color,
    this.size = AppSizing.icon20,
  });

  final PTabGlyph glyph;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: CustomPaint(
      size: Size.square(size),
      painter: _TabGlyphPainter(glyph: glyph, color: color),
    ),
  );
}

class _TabGlyphPainter extends CustomPainter {
  const _TabGlyphPainter({required this.glyph, required this.color});

  final PTabGlyph glyph;
  final Color color;

  /// Stroke as a fraction of the box, so it scales with [PTabGlyphIcon.size]
  /// (1.5 of 24, the iconography stroke).
  static const double _strokeFraction = 1.5 / 24;

  @override
  void paint(Canvas canvas, Size size) {
    final double u = size.width / 24; // 24-unit design grid.
    final Paint stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * _strokeFraction * 1.2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final Paint fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    switch (glyph) {
      case PTabGlyph.today:
        canvas.drawCircle(Offset(12 * u, 12 * u), 9 * u, stroke);
        canvas.drawCircle(Offset(12 * u, 12 * u), 4.2 * u, fill);
      case PTabGlyph.plan:
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTRB(3 * u, 3 * u, 21 * u, 21 * u),
            Radius.circular(3 * u),
          ),
          stroke,
        );
        canvas.drawLine(Offset(12 * u, 3 * u), Offset(12 * u, 21 * u), stroke);
        canvas.drawLine(Offset(3 * u, 12 * u), Offset(21 * u, 12 * u), stroke);
      case PTabGlyph.pantry:
        final Path hull = Path()
          ..moveTo(12 * u, 2.5 * u)
          ..lineTo(20.5 * u, 7.2 * u)
          ..lineTo(20.5 * u, 16.8 * u)
          ..lineTo(12 * u, 21.5 * u)
          ..lineTo(3.5 * u, 16.8 * u)
          ..lineTo(3.5 * u, 7.2 * u)
          ..close();
        canvas.drawPath(hull, stroke);
        final Path edges = Path()
          ..moveTo(3.5 * u, 7.2 * u)
          ..lineTo(12 * u, 12 * u)
          ..lineTo(20.5 * u, 7.2 * u)
          ..moveTo(12 * u, 12 * u)
          ..lineTo(12 * u, 21.5 * u);
        canvas.drawPath(edges, stroke);
      case PTabGlyph.recipes:
        final Path book = Path()
          ..moveTo(12 * u, 6 * u)
          ..cubicTo(9.5 * u, 4 * u, 6 * u, 4 * u, 3 * u, 5 * u)
          ..lineTo(3 * u, 19 * u)
          ..cubicTo(6 * u, 18 * u, 9.5 * u, 18 * u, 12 * u, 20 * u)
          ..cubicTo(14.5 * u, 18 * u, 18 * u, 18 * u, 21 * u, 19 * u)
          ..lineTo(21 * u, 5 * u)
          ..cubicTo(18 * u, 4 * u, 14.5 * u, 4 * u, 12 * u, 6 * u)
          ..close();
        canvas.drawPath(book, stroke);
        canvas.drawLine(Offset(12 * u, 6 * u), Offset(12 * u, 20 * u), stroke);
    }
  }

  @override
  bool shouldRepaint(_TabGlyphPainter old) =>
      old.glyph != glyph || old.color != color;
}
