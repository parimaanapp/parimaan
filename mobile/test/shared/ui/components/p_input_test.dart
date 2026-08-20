import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_input.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

InputDecoration _decoration(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).decoration!;

void main() {
  group('PInput — basics', () {
    testWidgets('renders its label and hint', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Recipe name', hintText: 'e.g. Aloo Gobi'),
        width: 320,
      );

      expect(find.text('Recipe name'), findsOneWidget);
      expect(_decoration(tester).hintText, 'e.g. Aloo Gobi');
    });

    testWidgets('reports every keystroke through onChanged', (
      WidgetTester tester,
    ) async {
      final List<String> seen = <String>[];
      await pumpComponent(
        tester,
        PInput(label: 'Recipe name', onChanged: seen.add),
        width: 320,
      );

      await tester.enterText(find.byType(TextField), 'Rajma');

      expect(seen, <String>['Rajma']);
    });

    testWidgets('is at least one touch target tall', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Recipe name'),
        width: 320,
      );

      expect(
        tester.getSize(find.byType(TextField)).height,
        greaterThanOrEqualTo(AppSizing.minTouchTargetHeight),
      );
    });

    testWidgets('disabled input does not accept focus', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Recipe name', enabled: false),
        width: 320,
      );

      expect(tester.widget<TextField>(find.byType(TextField)).enabled, false);
    });
  });

  group('PInput — states', () {
    testWidgets('default border is the neutral outline', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Recipe name'),
        width: 320,
      );

      expect(
        _decoration(tester).enabledBorder,
        isA<OutlineInputBorder>().having(
          (OutlineInputBorder b) => b.borderSide.color,
          'colour',
          AppColors.inkMid,
        ),
      );
    });

    testWidgets('focused border is terracotta', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Recipe name'),
        width: 320,
      );

      expect(
        _decoration(tester).focusedBorder,
        isA<OutlineInputBorder>().having(
          (OutlineInputBorder b) => b.borderSide.color,
          'colour',
          AppColors.terracotta,
        ),
      );
    });

    testWidgets(
      'error state pairs the danger border with visible helper text — '
      'never colour alone',
      (WidgetTester tester) async {
        await pumpComponent(
          tester,
          const PInput(
            label: 'Invite code',
            errorText: "Codes don't contain 0, O, I, or L.",
          ),
          width: 320,
        );

        expect(find.text("Codes don't contain 0, O, I, or L."), findsOneWidget);
        expect(
          _decoration(tester).errorBorder,
          isA<OutlineInputBorder>().having(
            (OutlineInputBorder b) => b.borderSide.color,
            'colour',
            AppColors.danger,
          ),
        );
      },
    );

    testWidgets('error text takes precedence over helper text', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(
          label: 'Invite code',
          helperText: 'Six characters',
          errorText: 'That code has expired.',
        ),
        width: 320,
      );

      expect(find.text('That code has expired.'), findsOneWidget);
      expect(find.text('Six characters'), findsNothing);
    });

    testWidgets('announces the error to screen readers', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Invite code', errorText: 'That code has expired.'),
        width: 320,
      );

      await withSemantics(tester, () async {
        expect(
          find.bySemanticsLabel(RegExp('That code has expired')),
          findsWidgets,
        );
      });
    });
  });

  group('PInput — configurations rather than sub-widgets', () {
    testWidgets('search: a prefix icon plus a hint', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(
          label: 'Find a recipe',
          hintText: 'Sabzi, dal, chicken…',
          prefixIcon: Icons.search,
        ),
        width: 320,
      );

      expect(_decoration(tester).prefixIcon, isNotNull);
      expect(find.byIcon(Icons.search), findsOneWidget);
    });

    testWidgets('number + unit: mono font, right aligned, trailing slot', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        const PInput(
          label: 'Quantity',
          useMonoFont: true,
          textAlign: TextAlign.right,
          trailing: Text('g'),
        ),
        width: 320,
      );

      final TextField field = tester.widget<TextField>(find.byType(TextField));
      expect(field.textAlign, TextAlign.right);
      expect(field.style!.fontFamily, AppFontFamily.mono);
      expect(find.text('g'), findsOneWidget);
    });

    testWidgets('textarea: grows via maxLines', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PInput(label: 'Paste or type', minLines: 3, maxLines: 6),
        width: 320,
      );

      final TextField field = tester.widget<TextField>(find.byType(TextField));
      expect(field.minLines, 3);
      expect(field.maxLines, 6);
    });
  });
}
