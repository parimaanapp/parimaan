import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/shared/ui/components/p_button.dart';
import 'package:mobile/shared/ui/tokens.dart';

import '../../../support/component_harness.dart';

/// Resolves the [ButtonStyle] the component handed to the framework, for the
/// given widget states. Asserting on the resolved style (rather than on pixels)
/// is what keeps these tests about *intent* — goldens cover the pixels.
ButtonStyle _styleOf(WidgetTester tester) =>
    tester.widget<TextButton>(find.byType(TextButton)).style!;

Color? _bg(WidgetTester tester, [Set<WidgetState> states = const {}]) =>
    _styleOf(tester).backgroundColor!.resolve(states);

Color? _fg(WidgetTester tester, [Set<WidgetState> states = const {}]) =>
    _styleOf(tester).foregroundColor!.resolve(states);

BorderSide? _side(WidgetTester tester, [Set<WidgetState> states = const {}]) =>
    _styleOf(tester).side?.resolve(states);

void main() {
  group('PButton — interaction', () {
    testWidgets('calls onPressed when tapped', (WidgetTester tester) async {
      int taps = 0;
      await pumpComponent(
        tester,
        PButton(label: 'Plan the week', onPressed: () => taps++),
      );

      await tester.tap(find.byType(PButton));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('is inert when onPressed is null', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        const PButton(label: 'Plan the week', onPressed: null),
      );

      expect(tester.widget<TextButton>(find.byType(TextButton)).enabled, false);
    });

    testWidgets('is inert while loading, even with a callback', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpComponent(
        tester,
        PButton(
          label: 'Plan the week',
          isLoading: true,
          onPressed: () => taps++,
        ),
      );

      await tester.tap(find.byType(PButton), warnIfMissed: false);
      await tester.pump();

      expect(taps, 0);
    });
  });

  group('PButton — loading state', () {
    testWidgets('shows a spinner and the loading label', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton(
          label: 'Plan the week',
          loadingLabel: 'Planning…',
          isLoading: true,
          onPressed: () {},
        ),
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Planning…'), findsOneWidget);
      expect(find.text('Plan the week'), findsNothing);
    });

    testWidgets('falls back to the normal label when none is given', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton(label: 'Plan the week', isLoading: true, onPressed: () {}),
      );

      expect(find.text('Plan the week'), findsOneWidget);
    });
  });

  group('PButton — touch target', () {
    for (final PButtonSize size in PButtonSize.values) {
      testWidgets('${size.name} size is at least the min touch target', (
        WidgetTester tester,
      ) async {
        await pumpComponent(
          tester,
          PButton(label: 'Edit', size: size, onPressed: () {}),
        );

        final Size rendered = tester.getSize(find.byType(PButton));
        expect(
          rendered.height,
          greaterThanOrEqualTo(AppSizing.buttonMinHeight),
          reason: 'componentRules.buttons.minHeight is non-negotiable',
        );
        expect(
          rendered.width,
          greaterThanOrEqualTo(AppSizing.minTouchTargetWidth),
        );
      });
    }
  });

  group('PButton — variants', () {
    testWidgets('primary is filled terracotta, deep when pressed', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PButton(label: 'Go', onPressed: () {}));

      expect(_bg(tester), AppColors.terracotta);
      expect(_bg(tester, {WidgetState.pressed}), AppColors.terracottaDeep);
      expect(_fg(tester), AppColors.paper);
    });

    testWidgets('secondary is outlined, not filled', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton(
          label: 'Add to pantry',
          variant: PButtonVariant.secondary,
          onPressed: () {},
        ),
      );

      expect(_bg(tester)!.a, 0);
      expect(_side(tester)!.color, AppColors.outline);
      expect(_side(tester)!.width, 1);
      expect(_fg(tester), AppColors.ink);
    });

    testWidgets('ghost has neither fill nor border', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton(
          label: 'Skip for now',
          variant: PButtonVariant.ghost,
          onPressed: () {},
        ),
      );

      expect(_bg(tester)!.a, 0);
      expect(_side(tester), isNull);
      expect(_fg(tester), AppColors.terracottaDeep);
    });

    testWidgets('affirmative is filled cardamom', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        PButton(
          label: 'Have it',
          variant: PButtonVariant.affirmative,
          onPressed: () {},
        ),
      );

      expect(_bg(tester), AppColors.cardamom);
      expect(_fg(tester), AppColors.paper);
    });

    testWidgets('destructive is outlined danger and NEVER filled', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton(
          label: 'Clear week',
          variant: PButtonVariant.destructive,
          onPressed: () {},
        ),
      );

      expect(_fg(tester), AppColors.danger);
      expect(_side(tester)!.color, AppColors.dangerOutline);
      for (final Set<WidgetState> states in <Set<WidgetState>>[
        <WidgetState>{},
        <WidgetState>{WidgetState.pressed},
        <WidgetState>{WidgetState.hovered},
        <WidgetState>{WidgetState.focused},
        <WidgetState>{WidgetState.disabled},
      ]) {
        expect(
          _bg(tester, states)!.a,
          0,
          reason: 'destructive is always outlined, never filled ($states)',
        );
      }
    });

    testWidgets('dark is filled ink with paper text', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton(
          label: 'Auto-fill',
          variant: PButtonVariant.dark,
          onPressed: () {},
        ),
      );

      expect(_bg(tester), AppColors.ink);
      expect(_fg(tester), AppColors.paper);
      expect(_side(tester), isNull);
    });

    testWidgets('weights follow the wireframe: 600 filled, 500 the rest', (
      WidgetTester tester,
    ) async {
      const Map<PButtonVariant, FontWeight> expected =
          <PButtonVariant, FontWeight>{
            PButtonVariant.primary: FontWeight.w600,
            PButtonVariant.affirmative: FontWeight.w600,
            PButtonVariant.dark: FontWeight.w600,
            PButtonVariant.secondary: FontWeight.w500,
            PButtonVariant.ghost: FontWeight.w500,
            PButtonVariant.destructive: FontWeight.w500,
          };
      for (final MapEntry<PButtonVariant, FontWeight> e in expected.entries) {
        await pumpComponent(
          tester,
          PButton(label: 'Go', variant: e.key, onPressed: () {}),
        );
        final TextStyle? style = _styleOf(tester).textStyle?.resolve(const {});
        expect(style!.fontWeight, e.value, reason: e.key.name);
      }
    });

    testWidgets('filled variants use large text: >= 18.66 px at w600', (
      WidgetTester tester,
    ) async {
      for (final PButtonVariant v in <PButtonVariant>[
        PButtonVariant.primary,
        PButtonVariant.affirmative,
        PButtonVariant.dark,
      ]) {
        for (final PButtonSize size in PButtonSize.values) {
          await pumpComponent(
            tester,
            PButton(label: 'Go', variant: v, size: size, onPressed: () {}),
          );
          final TextStyle style = _styleOf(tester).textStyle!.resolve(const {})!;
          expect(style.fontSize, greaterThanOrEqualTo(18.66), reason: '$v $size');
          expect(
            style.fontWeight!.value,
            greaterThanOrEqualTo(FontWeight.w600.value),
          );
        }
      }
    });

    testWidgets('a long filled label wraps instead of truncating, at 320 pt '
        'and 2x text scale', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(
              size: Size(320, 640),
              textScaler: TextScaler.linear(2),
            ),
            child: Scaffold(
              body: Padding(
                padding: const EdgeInsets.all(16),
                child: PButton(
                  label: 'Create household and continue to setup',
                  expand: true,
                  onPressed: () {},
                ),
              ),
            ),
          ),
        ),
      );

      expect(tester.takeException(), isNull);
      final Size size = tester.getSize(find.byType(PButton));
      expect(size.width, lessThanOrEqualTo(320));
      expect(size.height, greaterThan(AppSizing.buttonMinHeight));
      final Text text = tester.widget<Text>(
        find.text('Create household and continue to setup'),
      );
      expect(text.overflow, isNot(TextOverflow.ellipsis));
    });

    testWidgets('every standard button is radius 12', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PButton(label: 'Go', onPressed: () {}));

      final OutlinedBorder? shape = _styleOf(tester).shape?.resolve(const {});
      expect(
        (shape! as RoundedRectangleBorder).borderRadius,
        AppRadius.borderM,
      );
    });

    testWidgets('every variant renders its text label — colour never alone', (
      WidgetTester tester,
    ) async {
      for (final PButtonVariant variant in PButtonVariant.values) {
        await pumpComponent(
          tester,
          PButton(label: 'Confirm', variant: variant, onPressed: () {}),
        );
        expect(find.text('Confirm'), findsOneWidget, reason: variant.name);
      }
    });
  });

  group('PButton — focus ring', () {
    testWidgets('focused state uses the haldi ring, not an OS outline', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PButton(label: 'Go', onPressed: () {}));

      final BorderSide? focused = _side(tester, {WidgetState.focused});
      expect(focused, isNotNull);
      expect(focused!.color, AppColors.haldi);
      expect(focused.width, AppSizing.focusRingWidth);
    });
  });

  group('PButton — disabled styling', () {
    testWidgets('disabled primary drops to a translucent ink wash', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, const PButton(label: 'Go', onPressed: null));

      // A blend off AppColors.ink, matching the design source's
      // `rgba(31,26,21,0.12)` disabled fill — not an opaque named surface.
      final Color disabledBg = _bg(tester, {WidgetState.disabled})!;
      expect(disabledBg.withValues(alpha: 1), AppColors.ink);
      expect(disabledBg.a, closeTo(0.12, 0.005));
      expect(_fg(tester, {WidgetState.disabled}), AppColors.inkMid);
    });
  });

  group('PButton.icon', () {
    testWidgets('is a square min-touch-target control', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton.icon(
          icon: Icons.add,
          semanticLabel: 'Add item',
          onPressed: () {},
        ),
      );

      final Size rendered = tester.getSize(find.byType(PButton));
      expect(rendered.width, AppSizing.minTouchTargetWidth);
      expect(rendered.height, AppSizing.minTouchTargetHeight);
    });

    testWidgets('exposes its semantic label to screen readers', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        PButton.icon(
          icon: Icons.add,
          semanticLabel: 'Add item',
          onPressed: () {},
        ),
      );

      await withSemantics(tester, () async {
        expect(find.bySemanticsLabel('Add item'), findsWidgets);
      });
    });
  });
}
