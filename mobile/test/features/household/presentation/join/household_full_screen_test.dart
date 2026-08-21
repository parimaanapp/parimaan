import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/presentation/join/household_full_screen.dart';
import 'package:mobile/features/household/state/join_household_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../../support/fake_household_repository.dart';
import '../../../../support/household_route_harness.dart';

void main() {
  group('HouseholdFullScreen — wireframe 3.3 copy', () {
    testWidgets('renders the heading and the 5 / 5 member count', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHouseholdFull);

      expect(find.text(HouseholdFullScreen.heading), findsOne);
      expect(
        find.text('Members: 5 / 5. Ask the primary to make room.'),
        findsOne,
      );
    });

    test('the rendered cap matches the server constant', () {
      // `HOUSEHOLD_MEMBER_CAP` in `api/src/domain/householdLimits.ts`. A
      // server-side change not mirrored here fails here rather than quietly
      // lying on screen.
      expect(HouseholdFullScreen.memberCap, 5);
    });
  });

  group('HouseholdFullScreen — the Notify primary button', () {
    testWidgets('is present but disabled — there is no mutation behind it', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHouseholdFull);

      final PButton button = tester.widget<PButton>(
        find.byKey(HouseholdFullScreen.notifyButtonKey),
      );

      expect(button.label, HouseholdFullScreen.notifyLabel);
      expect(
        button.onPressed,
        isNull,
        reason: 'a working button would mean inventing a server operation',
      );
    });

    testWidgets('carries the literal "v1.1 feature" hint underneath', (
      WidgetTester tester,
    ) async {
      await pumpHouseholdRoute(tester, AppRoutes.joinHouseholdFull);

      expect(find.text(HouseholdFullScreen.notifyHint), findsOne);
    });
  });

  group('HouseholdFullScreen — getting out', () {
    testWidgets('the back button returns to the code entry', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinHouseholdFull,
      );

      await tester.tap(find.byType(PTopBarBackButton));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.joinHousehold);
    });

    testWidgets('"Try a different code" returns to the code entry', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        AppRoutes.joinHouseholdFull,
      );

      await tester.tap(find.byKey(HouseholdFullScreen.backButtonKey));
      await tester.pumpAndSettle();

      expect(location(harness.router), AppRoutes.joinHousehold);
    });

    testWidgets(
      'leaving clears the failed attempt, so 3.1 reopens without a stale '
      'error',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          AppRoutes.joinHouseholdFull,
          repository: FakeHouseholdRepository(
            joinError: const HouseholdFullError('This household is full.'),
          ),
        );

        // Put a real failure in the controller first.
        await harness.container
            .read(joinHouseholdControllerProvider.notifier)
            .join('K4M9PQ');
        await tester.pumpAndSettle();
        expect(
          harness.container.read(joinHouseholdControllerProvider).hasError,
          isTrue,
        );

        await tester.tap(find.byKey(HouseholdFullScreen.backButtonKey));
        await tester.pumpAndSettle();

        expect(
          harness.container.read(joinHouseholdControllerProvider).hasError,
          isFalse,
        );
      },
    );
  });
}
