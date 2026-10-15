import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/shopping_list/presentation/list_generated_prompt_screen.dart';
import 'package:mobile/shared/ui/colors.dart';
import 'package:mobile/shared/ui/theme.dart';

const ShoppingListFlowExtra _extra = (
  menuId: 'menu-1',
  householdId: 'household-1',
);

/// Mounts the prompt on top of a "weekly-plan" page so a pop is observable.
Future<GoRouter> _pump(WidgetTester tester) async {
  final GoRouter router = GoRouter(
    initialLocation: '/plan',
    routes: <RouteBase>[
      GoRoute(
        path: '/plan',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: TextButton(
            onPressed: () => context.push(
              AppRoutes.shoppingListGeneratedPrompt,
              extra: _extra,
            ),
            child: const Text('open-prompt'),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.shoppingListGeneratedPrompt,
        builder: (BuildContext context, GoRouterState state) =>
            ListGeneratedPromptScreen(extra: _extra),
      ),
      GoRoute(
        path: AppRoutes.shoppingListPreview,
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('preview-route')),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
  );
  await tester.tap(find.text('open-prompt'));
  await tester.pumpAndSettle();
  return router;
}

void main() {
  group('ListGeneratedPromptScreen — week confirmed (wireframe 6.4, C2)', () {
    testWidgets('shows "Week is set!", the haldi-soft note and both actions', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text('Week is set!'), findsOneWidget);
      expect(
        find.text('Shopping list can now be generated from these recipes.'),
        findsOneWidget,
      );
      expect(find.text('Generate shopping list'), findsOneWidget);
      expect(find.text('I\'ll do it later'), findsOneWidget);

      final DecoratedBox note = tester.widget<DecoratedBox>(
        find.byKey(ListGeneratedPromptScreen.noteKey),
      );
      expect((note.decoration as BoxDecoration).color, AppColors.haldiSoft);
    });

    testWidgets('Generate shopping list opens the preview', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(ListGeneratedPromptScreen.generateButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('preview-route'), findsOneWidget);
    });

    testWidgets('"I\'ll do it later" returns to the plan', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(ListGeneratedPromptScreen.laterButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('open-prompt'), findsOneWidget);
      expect(find.text('Week is set!'), findsNothing);
    });

    testWidgets('has a back affordance that returns to the plan', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.bySemanticsLabel('Back to weekly plan'));
      await tester.pumpAndSettle();

      expect(find.text('open-prompt'), findsOneWidget);
    });

    testWidgets('both buttons are at least 44 pt tall', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      for (final Key key in <Key>[
        ListGeneratedPromptScreen.generateButtonKey,
        ListGeneratedPromptScreen.laterButtonKey,
      ]) {
        expect(
          tester.getSize(find.byKey(key)).height,
          greaterThanOrEqualTo(44),
        );
      }
    });

    testWidgets('exposes the actions to screen readers', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester);

      expect(find.bySemanticsLabel('Generate shopping list'), findsOneWidget);
      expect(find.bySemanticsLabel('I\'ll do it later'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('does not overflow at 320 pt with large text', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 1.6;
      addTearDown(() {
        tester.view.reset();
        tester.platformDispatcher.clearAllTestValues();
      });
      await _pump(tester);

      expect(tester.takeException(), isNull);
    });
  });
}
