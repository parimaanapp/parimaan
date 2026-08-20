import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_toast.dart';
import 'package:mobile/shared/ui/theme.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

BoxDecoration _decoration(WidgetTester tester) =>
    tester
            .widget<Container>(
              find
                  .descendant(
                    of: find.byType(PToast),
                    matching: find.byType(Container),
                  )
                  .first,
            )
            .decoration!
        as BoxDecoration;

void main() {
  group('PToast — the visual component', () {
    testWidgets('renders its message', (WidgetTester tester) async {
      await pumpFullWidth(tester, const PToast(message: 'Added to pantry'));

      expect(find.text('Added to pantry'), findsOneWidget);
    });

    testWidgets('rests at e1 on a card surface', (WidgetTester tester) async {
      await pumpFullWidth(tester, const PToast(message: 'Added to pantry'));

      final BoxDecoration decoration = _decoration(tester);
      expect(decoration.color, AppColors.card);
      expect(decoration.boxShadow, AppElevation.e1);
      expect(decoration.borderRadius, AppRadius.borderM);
    });

    testWidgets('every tone renders the message text beside its colour', (
      WidgetTester tester,
    ) async {
      for (final PToastTone tone in PToastTone.values) {
        await pumpFullWidth(tester, PToast(message: tone.name, tone: tone));
        expect(
          find.text(tone.name),
          findsOneWidget,
          reason: 'colour must never be the only signal (${tone.name})',
        );
      }
    });

    testWidgets('tone drives a leading accent that is not the only signal', (
      WidgetTester tester,
    ) async {
      await pumpFullWidth(
        tester,
        const PToast(message: 'Saved', tone: PToastTone.success),
      );

      expect(find.byKey(PToast.accentKey), findsOneWidget);
      expect(find.text('Saved'), findsOneWidget);
    });

    testWidgets('optional action is a min-touch-target control', (
      WidgetTester tester,
    ) async {
      int undos = 0;
      await pumpFullWidth(
        tester,
        PToast(
          message: 'Removed from list',
          actionLabel: 'Undo',
          onAction: () => undos++,
        ),
      );

      // Measure the tappable ConstrainedBox, not the Text glyph inside it —
      // the text itself is intentionally smaller than the floor; it's the
      // InkWell's own hit area that must meet it.
      final Size actionSize = tester.getSize(
        find.ancestor(
          of: find.text('Undo'),
          matching: find.byType(ConstrainedBox),
        ),
      );
      expect(
        actionSize.width,
        greaterThanOrEqualTo(AppSizing.minTouchTargetWidth),
      );
      expect(
        actionSize.height,
        greaterThanOrEqualTo(AppSizing.minTouchTargetHeight),
      );
      await tester.tap(find.text('Undo'));
      await tester.pump();

      expect(undos, 1);
    });

    testWidgets('requires onAction whenever an action label is given', (
      WidgetTester tester,
    ) async {
      expect(
        () => PToast(message: 'Removed', actionLabel: 'Undo'),
        throwsAssertionError,
      );
    });
  });

  group('PToast.show — the transience wrapper', () {
    testWidgets('puts the toast on screen and takes it away again', (
      WidgetTester tester,
    ) async {
      const Duration visibleFor = Duration(seconds: 3);
      await tester.pumpWidget(
        MaterialApp(
          theme: parimaanTheme(),
          home: Scaffold(
            body: Builder(
              builder: (BuildContext context) => TextButton(
                onPressed: () => PToast.show(
                  context: context,
                  toast: const PToast(message: 'Added to pantry'),
                  duration: visibleFor,
                ),
                child: const Text('go'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();
      expect(find.byType(PToast), findsOneWidget);

      await tester.pump(visibleFor);
      await tester.pumpAndSettle();
      expect(find.byType(PToast), findsNothing);
    });

    testWidgets('rides on a transparent SnackBar so PToast owns the pixels', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: parimaanTheme(),
          home: Scaffold(
            body: Builder(
              builder: (BuildContext context) => TextButton(
                onPressed: () => PToast.show(
                  context: context,
                  toast: const PToast(message: 'Added to pantry'),
                  duration: const Duration(seconds: 3),
                ),
                child: const Text('go'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('go'));
      await tester.pumpAndSettle();

      final SnackBar bar = tester.widget<SnackBar>(find.byType(SnackBar));
      expect(bar.backgroundColor!.a, 0);
      expect(bar.elevation, 0);
      expect(bar.behavior, SnackBarBehavior.floating);
    });
  });
}
