import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/state/me_households_controller.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/presentation/pantry_list_screen.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_pantry_repository.dart';
import '../../../support/household_fixtures.dart';

final PantryItem _dal = PantryItem(
  id: 'item-1',
  householdId: 'household-1',
  name: 'Toor Dal',
  quantity: 2,
  unit: 'kg',
  category: 'dal',
  isStaple: true,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  required FakePantryRepository pantryRepository,
}) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(
        FakeHouseholdRepository(myHouseholdsResult: <Household>[testHousehold]),
      ),
      pantryRepositoryProvider.overrideWithValue(pantryRepository),
    ],
  );
  addTearDown(container.dispose);
  // Same "await the household source before pumping" step
  // `current_household_controller_test.dart`'s `activeHouseholdProvider`
  // tests use — otherwise the screen's first build races `Query.me`.
  await container.read(meHouseholdsControllerProvider.future);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: const PantryListScreen(),
      ),
    ),
  );
  return container;
}

void main() {
  group('PantryListScreen', () {
    testWidgets('shows a loading indicator before the fetch resolves', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
        delay: const Duration(milliseconds: 50),
      );
      await _pump(tester, pantryRepository: repository);

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      await tester.pumpAndSettle();
    });

    testWidgets('renders one PantryRow per item once loaded', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      await _pump(tester, pantryRepository: repository);
      await tester.pumpAndSettle();

      expect(find.text('Toor Dal'), findsOneWidget);
    });

    testWidgets('shows an empty state when the pantry has no items', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[],
      );
      await _pump(tester, pantryRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(PantryListScreen.emptyStateKey), findsOneWidget);
    });

    testWidgets('shows an error state when the repository throws', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        error: const InternalError('network down'),
      );
      await _pump(tester, pantryRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(PantryListScreen.errorStateKey), findsOneWidget);
    });

    testWidgets('renders a search field and category chips', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      await _pump(tester, pantryRepository: repository);
      await tester.pumpAndSettle();

      expect(find.byKey(PantryListScreen.searchFieldKey), findsOneWidget);
      expect(find.text('Dal'), findsOneWidget);
    });

    testWidgets('tapping a category chip refetches with that category', (
      WidgetTester tester,
    ) async {
      final FakePantryRepository repository = FakePantryRepository(
        result: <PantryItem>[_dal],
      );
      await _pump(tester, pantryRepository: repository);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Dal'));
      await tester.pumpAndSettle();

      expect(repository.calls.last.category, 'dal');
    });
  });
}
