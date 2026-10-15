import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/presentation/pantry_list_screen.dart';
import 'package:mobile/shared/storage/app_database.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_pantry_repository.dart';
import '../../../support/household_fixtures.dart';

Future<void> _pump(
  WidgetTester tester, {
  required List<PantryItem> items,
}) async {
  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(myHouseholdsResult: <Household>[testHousehold]),
      ),
      pantryRepositoryProvider.overrideWithValue(
        FakePantryRepository(result: items),
      ),
      appDatabaseProvider.overrideWithValue(db),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(db.close);
  await container.read(meHouseholdsControllerProvider.future);

  final GoRouter router = GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) =>
            const PantryListScreen(),
      ),
      GoRoute(
        path: '/home/cook',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Text('cook ${state.uri.queryParameters['householdId']}'),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(theme: parimaanTheme(), routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('PantryListScreen — Cook from pantry entry', () {
    testWidgets('a labelled action navigates to the cook trigger route', (
      WidgetTester tester,
    ) async {
      await _pump(tester, items: const <PantryItem>[]);

      expect(find.text('Cook from pantry'), findsOneWidget);
      await tester.tap(find.byKey(PantryListScreen.cookLabelledButtonKey));
      await tester.pumpAndSettle();

      expect(find.text('cook ${testHousehold.id}'), findsOneWidget);
    });

    testWidgets(
      'the labelled action is also present when the pantry has items',
      (WidgetTester tester) async {
        await _pump(
          tester,
          items: <PantryItem>[
            PantryItem(
              id: 'item-1',
              householdId: testHousehold.id,
              name: 'Toor Dal',
              quantity: 2,
              unit: 'kg',
              category: 'dal',
              isStaple: true,
              addedBy: 'user-1',
              addedAt: DateTime.utc(2026, 8, 25),
              updatedAt: DateTime.utc(2026, 8, 25),
            ),
          ],
        );

        expect(
          find.byKey(PantryListScreen.cookLabelledButtonKey),
          findsOneWidget,
        );
      },
    );
  });
}
