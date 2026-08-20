// Shared pump helpers for the `lib/shared/ui/components/` behaviour tests.
//
// Every component in that directory is stateless and Riverpod-free by
// contract, so the harness deliberately provides nothing but a `MaterialApp`
// carrying the real `parimaanTheme()` — if a component ever needed a provider
// scope to render, that would itself be the bug.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/theme.dart';

/// Pumps [child] centred on a Parimaan-themed scaffold.
Future<void> pumpComponent(
  WidgetTester tester,
  Widget child, {
  double? width,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: Scaffold(
        body: Center(
          child: width == null ? child : SizedBox(width: width, child: child),
        ),
      ),
    ),
  );
}

/// Runs [body] with the semantics tree materialised, then disposes the handle.
///
/// `find.bySemanticsLabel` and `matchesSemantics` both require semantics to be
/// switched on, and an undisposed handle fails the test — so every semantics
/// assertion goes through here.
Future<void> withSemantics(
  WidgetTester tester,
  Future<void> Function() body,
) async {
  final SemanticsHandle handle = tester.ensureSemantics();
  try {
    await body();
  } finally {
    handle.dispose();
  }
}

/// Pumps [child] as the whole body, unconstrained by a [Center] — used for
/// components that are meant to span the full width (top bar, tab bar, toast).
Future<void> pumpFullWidth(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: Scaffold(
        body: Align(alignment: Alignment.topCenter, child: child),
      ),
    ),
  );
}
