import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/recipes/presentation/recipe_method_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

/// Same "real minimal GoRouter, not a plain MaterialApp" harness as
/// `recipe_overflow_menu_test.dart`/`recipe_form_screen_test.dart` — every
/// option here navigates via `context.push`, which needs a real `GoRouter`
/// ancestor. Three destination routes, each rendering a marker `Text` so a
/// test can tell exactly which one was reached without needing the real
/// destination screens (the structured form is real and already tested
/// elsewhere; the URL/freeform placeholders are covered by their own tests).
///
/// Route paths here are stand-ins, not the app's real `/home/recipes/new/*`
/// patterns — this harness only needs to prove *this screen's* own
/// `context.push` calls reach *some* real route, not exercise
/// `router.dart`'s actual path strings. **That real-router wiring is
/// covered separately, in `router_test.dart`** (`AppRoutes.recipeChooseMethod`/
/// `recipeUrlImport`/`recipeFreeformInput` each pushed through the real
/// `goRouterProvider` and asserted to render the right screen with the
/// right `householdId`) — this file and that one are deliberately testing
/// different things, not duplicating each other.
Future<void> _pump(WidgetTester tester) async {
  final GoRouter router = GoRouter(
    initialLocation: '/method',
    routes: <RouteBase>[
      GoRoute(
        path: '/method',
        builder: (BuildContext context, GoRouterState state) =>
            const RecipeMethodScreen(householdId: 'household-1'),
      ),
      GoRoute(
        path: '/home/recipes/new',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('structured form')),
      ),
      GoRoute(
        path: '/home/recipes/new/url',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('url import')),
      ),
      GoRoute(
        path: '/home/recipes/new/freeform',
        builder: (BuildContext context, GoRouterState state) =>
            const Scaffold(body: Text('freeform input')),
      ),
    ],
  );

  await tester.pumpWidget(
    MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
  );
}

void main() {
  group('RecipeMethodScreen', () {
    testWidgets('renders all three options', (WidgetTester tester) async {
      await _pump(tester);

      expect(find.byKey(RecipeMethodScreen.structuredButtonKey), findsOneWidget);
      expect(find.byKey(RecipeMethodScreen.urlButtonKey), findsOneWidget);
      expect(find.byKey(RecipeMethodScreen.freeformButtonKey), findsOneWidget);
    });

    testWidgets(
      'all three options render at equal visual prominence — D10\'s 10-15/20 '
      'middle tier, no card wider/taller/badged than the others',
      (WidgetTester tester) async {
        await _pump(tester);

        final List<Size> sizes = <Key>[
          RecipeMethodScreen.structuredButtonKey,
          RecipeMethodScreen.urlButtonKey,
          RecipeMethodScreen.freeformButtonKey,
        ].map((Key key) => tester.getSize(find.byKey(key))).toList();

        // Same width (they're stacked in one Column) and — since none of
        // the three carries a badge, extra line of copy, or different
        // padding — the same height too. A future change that visually
        // promotes one option (a "Recommended" badge, bolder copy, more
        // padding) would grow that card's height and fail this test,
        // which is the point: D10 locked co-equal prominence, not just
        // "all three present."
        expect(sizes[0].width, sizes[1].width);
        expect(sizes[1].width, sizes[2].width);
        expect(sizes[0].height, sizes[1].height);
        expect(sizes[1].height, sizes[2].height);

        // No PBadge anywhere on this screen — the concrete mechanism this
        // codebase uses to visually flag one option over others (e.g. a
        // "Recommended" tag) is entirely absent, not just same-sized by
        // coincidence.
        expect(find.byType(PBadge), findsNothing);
      },
    );

    testWidgets('tapping "Type it in" routes to the structured form', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(RecipeMethodScreen.structuredButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('structured form'), findsOneWidget);
    });

    testWidgets('tapping "Import from a link" routes to URL import', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(RecipeMethodScreen.urlButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('url import'), findsOneWidget);
    });

    testWidgets('tapping "Paste recipe text" routes to freeform input', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      await tester.tap(find.byKey(RecipeMethodScreen.freeformButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('freeform input'), findsOneWidget);
    });
  });
}
