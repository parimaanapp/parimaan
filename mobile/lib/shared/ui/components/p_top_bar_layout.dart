import 'dart:math' as math;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Lays out `[leading, title, trailing]` for `PTopBar` with measured slots.
///
/// The title is centred on the bar with `max(leadingWidth, trailingWidth)`
/// (plus [gap]) reserved on **both** sides, so it is truly centred and never
/// touches either control. It wraps within what remains. If that would fall
/// below [minTitleWidth], the title falls back to start alignment in the
/// space between the two controls, so nothing overlaps. If even that is below
/// [minTitleWidth], the trailing control moves to its own end-aligned row
/// beneath the title.
///
/// Children are exactly three; an absent slot is a `SizedBox.shrink()`.
class PTopBarLayout extends MultiChildRenderObjectWidget {
  PTopBarLayout({
    super.key,
    required Widget leading,
    required Widget title,
    required Widget trailing,
    required this.gap,
    required this.minTitleWidth,
    required this.minHeight,
  }) : super(children: <Widget>[leading, title, trailing]);

  final double gap;
  final double minTitleWidth;
  final double minHeight;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderTopBar(Directionality.of(context), gap, minTitleWidth, minHeight);

  @override
  void updateRenderObject(BuildContext context, RenderObject renderObject) {
    (renderObject as _RenderTopBar)
      ..textDirection = Directionality.of(context)
      ..gap = gap
      ..minTitleWidth = minTitleWidth
      ..minHeight = minHeight;
  }
}

class _TopBarParentData extends ContainerBoxParentData<RenderBox> {}

class _RenderTopBar extends RenderBox
    with
        ContainerRenderObjectMixin<
          RenderBox,
          ContainerBoxParentData<RenderBox>
        >,
        RenderBoxContainerDefaultsMixin<
          RenderBox,
          ContainerBoxParentData<RenderBox>
        > {
  _RenderTopBar(
    this._textDirection,
    this._gap,
    this._minTitleWidth,
    this._minHeight,
  );

  TextDirection _textDirection;
  double _gap;
  double _minTitleWidth;
  double _minHeight;

  set textDirection(TextDirection v) {
    if (v == _textDirection) return;
    _textDirection = v;
    markNeedsLayout();
  }

  set gap(double v) {
    if (v == _gap) return;
    _gap = v;
    markNeedsLayout();
  }

  set minTitleWidth(double v) {
    if (v == _minTitleWidth) return;
    _minTitleWidth = v;
    markNeedsLayout();
  }

  set minHeight(double v) {
    if (v == _minHeight) return;
    _minHeight = v;
    markNeedsLayout();
  }

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _TopBarParentData) {
      child.parentData = _TopBarParentData();
    }
  }

  List<RenderBox> get _slots {
    final List<RenderBox> out = <RenderBox>[];
    RenderBox? c = firstChild;
    while (c != null) {
      out.add(c);
      c = (c.parentData! as ContainerBoxParentData<RenderBox>).nextSibling;
    }
    return out;
  }

  /// Positions are computed start-relative and mirrored for RTL.
  double _x(double startX, double width, double total) =>
      _textDirection == TextDirection.ltr ? startX : total - startX - width;

  Size _layoutAll(BoxConstraints constraints, {required bool dry}) {
    final List<RenderBox> s = _slots;
    final double maxW = constraints.maxWidth;
    final BoxConstraints loose = BoxConstraints(maxWidth: maxW);

    Size measure(RenderBox b, BoxConstraints c) {
      if (dry) return b.getDryLayout(c);
      b.layout(c, parentUsesSize: true);
      return b.size;
    }

    final Size lead = measure(s[0], loose);
    final Size trail = measure(s[2], loose);
    final double side = math.max(lead.width, trail.width);
    final double sideGap = side > 0 ? _gap : 0;
    final double centredAvail = maxW - 2 * (side + sideGap);

    final bool centred = centredAvail >= _minTitleWidth || side == 0;
    final double titleStart = centred
        ? 0
        : lead.width + (lead.width > 0 ? _gap : 0);
    final double betweenAvail = math.max(
      maxW - titleStart - trail.width - (trail.width > 0 ? _gap : 0),
      0,
    );
    // Neither centring nor sitting beside the trailing control leaves the
    // title a readable width (narrow screen and/or large text scale): drop
    // the trailing control onto its own row, end-aligned, so the title keeps
    // the full width beside the leading control instead of wrapping per
    // letter.
    final bool stacked =
        !centred && trail.width > 0 && betweenAvail < _minTitleWidth;
    final double titleMaxW = centred
        ? math.max(centredAvail, 0)
        : stacked
        ? math.max(maxW - titleStart, 0)
        : betweenAvail;
    final Size title = measure(s[1], BoxConstraints(maxWidth: titleMaxW));

    final double rowHeight = math.max(
      _minHeight,
      math.max(title.height, math.max(lead.height, stacked ? 0 : trail.height)),
    );
    final double height = constraints.constrainHeight(
      stacked ? rowHeight + trail.height : rowHeight,
    );
    final Size size = Size(maxW, height);
    if (dry) return size;

    final double titleX = centred ? (maxW - title.width) / 2 : titleStart;
    void place(RenderBox b, double startX, double w, double rowH) {
      final ContainerBoxParentData<RenderBox> pd =
          b.parentData! as ContainerBoxParentData<RenderBox>;
      pd.offset = Offset(_x(startX, w, maxW), (rowH - b.size.height) / 2);
    }

    place(s[0], 0, lead.width, rowHeight);
    place(s[1], titleX, title.width, rowHeight);
    if (stacked) {
      final ContainerBoxParentData<RenderBox> pd =
          s[2].parentData! as ContainerBoxParentData<RenderBox>;
      pd.offset = Offset(_x(maxW - trail.width, trail.width, maxW), rowHeight);
    } else {
      place(s[2], maxW - trail.width, trail.width, rowHeight);
    }
    return size;
  }

  @override
  Size computeDryLayout(BoxConstraints constraints) =>
      _layoutAll(constraints, dry: true);

  @override
  void performLayout() {
    size = _layoutAll(constraints, dry: false);
  }

  @override
  double computeMinIntrinsicHeight(double width) => _minHeight;

  @override
  double computeMaxIntrinsicHeight(double width) => _minHeight;

  @override
  double computeMinIntrinsicWidth(double height) => 0;

  @override
  double computeMaxIntrinsicWidth(double height) => 0;

  @override
  void paint(PaintingContext context, Offset offset) =>
      defaultPaint(context, offset);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);
}
