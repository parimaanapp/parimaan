import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/cook/domain/cook_vibe.dart';
import 'package:mobile/features/cook/presentation/cook_trigger_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

Future<void> _pump(
  WidgetTester tester, {
  required bool pantryTooSmall,
  required ValueChanged<CookVibe?> onSuggest,
  VoidCallback? onAddManually,
  VoidCallback? onBack,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: parimaanTheme(),
      home: CookTriggerScreen(
        pantryTooSmall: pantryTooSmall,
        onSuggest: onSuggest,
        onAddManually: onAddManually ?? () {},
        onBack: onBack,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('CookTriggerScreen', () {
    testWidgets(
      'shows the heading and all four vibe chips, Quick selected by default',
      (WidgetTester tester) async {
        await _pump(tester, pantryTooSmall: false, onSuggest: (_) {});

        expect(find.text('What can I cook?'), findsOneWidget);
        for (final CookVibe vibe in CookVibe.values) {
          expect(
            find.byKey(CookTriggerScreen.vibeChipKey(vibe)),
            findsOneWidget,
          );
        }
        expect(
          tester
              .widget<PChip>(
                find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.quick)),
              )
              .selected,
          isTrue,
        );
      },
    );

    testWidgets(
      'tapping a vibe chip selects it exclusively, and tapping the selected chip deselects to "any vibe"',
      (WidgetTester tester) async {
        await _pump(tester, pantryTooSmall: false, onSuggest: (_) {});

        await tester.tap(
          find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.comfort)),
        );
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<PChip>(
                find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.comfort)),
              )
              .selected,
          isTrue,
        );
        expect(
          tester
              .widget<PChip>(
                find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.quick)),
              )
              .selected,
          isFalse,
        );

        await tester.tap(
          find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.comfort)),
        );
        await tester.pumpAndSettle();
        for (final CookVibe vibe in CookVibe.values) {
          expect(
            tester
                .widget<PChip>(find.byKey(CookTriggerScreen.vibeChipKey(vibe)))
                .selected,
            isFalse,
          );
        }
      },
    );

    testWidgets('Suggest 3 recipes calls onSuggest with the selected vibe', (
      WidgetTester tester,
    ) async {
      CookVibe? received = CookVibe.quick;
      bool called = false;
      await _pump(
        tester,
        pantryTooSmall: false,
        onSuggest: (CookVibe? v) {
          called = true;
          received = v;
        },
      );

      await tester.tap(
        find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.weekend)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(CookTriggerScreen.suggestButtonKey));
      await tester.pumpAndSettle();

      expect(called, isTrue);
      expect(received, CookVibe.weekend);
    });

    testWidgets(
      'a too-small pantry shows the dead end instantly, with no vibe chips or network call',
      (WidgetTester tester) async {
        int suggestCalls = 0;
        await _pump(
          tester,
          pantryTooSmall: true,
          onSuggest: (_) => suggestCalls++,
        );

        expect(
          find.text("Your pantry's looking a little bare"),
          findsOneWidget,
        );
        expect(
          find.byKey(CookTriggerScreen.vibeChipKey(CookVibe.quick)),
          findsNothing,
        );
        expect(suggestCalls, 0);
      },
    );

    testWidgets('the dead end\'s "add a recipe myself" calls onAddManually', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await _pump(
        tester,
        pantryTooSmall: true,
        onSuggest: (_) {},
        onAddManually: () => taps++,
      );

      await tester.tap(find.text('Add a recipe myself'));
      await tester.pumpAndSettle();

      expect(taps, 1);
    });

    testWidgets('the back button calls onBack when provided', (
      WidgetTester tester,
    ) async {
      int backTaps = 0;
      await _pump(
        tester,
        pantryTooSmall: false,
        onSuggest: (_) {},
        onBack: () => backTaps++,
      );

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(backTaps, 1);
    });
  });
}
