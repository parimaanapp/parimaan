import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/presentation/household_resolving_view.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_household_repository.dart';

const Key _spinnerKey = Key('test-spinner');

Future<FakeHouseholdRepository> _pump(
  WidgetTester tester,
  FakeHouseholdRepository repository,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        householdRepositoryProvider.overrideWithValue(repository),
        householdResolveTimeoutProvider.overrideWithValue(
          const Duration(seconds: 5),
        ),
      ],
      child: MaterialApp(
        theme: parimaanTheme(),
        home: const Scaffold(
          body: HouseholdResolvingView(loadingKey: _spinnerKey),
        ),
      ),
    ),
  );
  return repository;
}

void main() {
  testWidgets('spins while the household list is in flight', (tester) async {
    await _pump(tester, FakeHouseholdRepository(neverCompletes: true));
    await tester.pump();

    expect(find.byKey(_spinnerKey), findsOneWidget);
    expect(find.byKey(HouseholdResolvingView.retryStateKey), findsNothing);
  });

  testWidgets('a stuck load turns into a Retry state after the timeout', (
    tester,
  ) async {
    await _pump(tester, FakeHouseholdRepository(neverCompletes: true));
    await tester.pump(const Duration(seconds: 6));

    expect(find.byKey(_spinnerKey), findsNothing);
    expect(find.byKey(HouseholdResolvingView.retryStateKey), findsOneWidget);
  });

  testWidgets('an errored list shows Retry immediately and retry refetches', (
    tester,
  ) async {
    final FakeHouseholdRepository repository = FakeHouseholdRepository(
      myHouseholdsError: const InternalError('boom'),
    );
    await _pump(tester, repository);
    await tester.pump();

    expect(find.byKey(HouseholdResolvingView.retryStateKey), findsOneWidget);
    final int before = repository.myHouseholdsCallCount;

    await tester.tap(find.text('Try again'));
    await tester.pump();
    await tester.pump();

    expect(repository.myHouseholdsCallCount, greaterThan(before));
  });

  testWidgets('a list that resolves empty is not an endless spinner', (
    tester,
  ) async {
    await _pump(
      tester,
      FakeHouseholdRepository(myHouseholdsResult: const <Household>[]),
    );
    await tester.pump();

    expect(find.byKey(_spinnerKey), findsNothing);
    expect(find.byKey(HouseholdResolvingView.retryStateKey), findsOneWidget);
  });
}
