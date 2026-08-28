import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/recipes/presentation/freeform_input_screen.dart';
import 'package:mobile/shared/ui/theme.dart';

/// Pushes `FreeformInputScreen` on top of a marker screen, so a test can
/// assert tapping either "Back" affordance actually pops back to it — same
/// two-route harness shape as `url_import_screen_test.dart`'s own.
Future<void> _pumpPushed(WidgetTester tester) async {
  final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: ElevatedButton(
                onPressed: () => context.push('/freeform'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
      GoRoute(
        path: '/freeform',
        builder: (BuildContext context, GoRouterState state) =>
            const FreeformInputScreen(householdId: 'household-1'),
      ),
    ],
  );

  await tester.pumpWidget(
    MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('FreeformInputScreen', () {
    testWidgets(
      'renders a real, non-dead-end placeholder — a "coming soon" state with a way back, not a blank screen',
      (WidgetTester tester) async {
        await _pumpPushed(tester);

        expect(find.byKey(FreeformInputScreen.emptyStateKey), findsOneWidget);
        expect(find.text('Back'), findsWidgets);
      },
    );

    testWidgets('tapping the empty-state "Back" button actually pops', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester);

      await tester.tap(find.text('Back').last);
      await tester.pumpAndSettle();

      expect(find.byType(FreeformInputScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets('tapping the top-bar back button actually pops', (
      WidgetTester tester,
    ) async {
      await _pumpPushed(tester);

      await tester.tap(find.text('Back').first);
      await tester.pumpAndSettle();

      expect(find.byType(FreeformInputScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });
  });
}
