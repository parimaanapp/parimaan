import 'package:flutter/material.dart';

import '../../../shared/ui/spacing.dart';

/// A decorative [glyph] (◆, ↗) followed by [text]. The glyph is hidden from
/// assistive technology so the accessible name is just [text].
class GlyphLabel extends StatelessWidget {
  const GlyphLabel({
    super.key,
    required this.glyph,
    required this.text,
    required this.style,
  });

  final String glyph;
  final String text;
  final TextStyle style;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      ExcludeSemantics(child: Text(glyph, style: style)),
      const SizedBox(width: AppSpacing.s0),
      Flexible(child: Text(text, style: style)),
    ],
  );
}
