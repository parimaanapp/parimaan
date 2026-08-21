import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/auth/domain/auth_session.dart';
import 'package:mobile/features/household/presentation/join/enter_code_screen.dart';
import 'package:mobile/features/household/presentation/join/invite_code_field.dart';
import 'package:mobile/features/household/state/pending_join_code_controller.dart';

import '../support/fake_auth_repository.dart';
import '../support/household_route_harness.dart';

/// Pushes a deep link through the *real* `app_links` seam and settles.
Future<void> _link(
  WidgetTester tester,
  HouseholdHarness harness,
  String uri,
) async {
  harness.links.add(Uri.parse(uri));
  await tester.pumpAndSettle();
}

/// The text currently shown across the six code boxes.
String _codeInBoxes(WidgetTester tester) =>
    tester
        .widget<TextField>(find.byKey(InviteCodeField.hiddenFieldKey))
        .controller
        ?.text ??
    '';

void main() {
  group('deep link — signed in', () {
    testWidgets('a valid join link routes to the Enter-code screen', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, null);
      expect(location(harness.router), AppRoutes.firstRun);

      await _link(tester, harness, 'parimaan://join?code=K4M9PQ');

      expect(location(harness.router), AppRoutes.joinHousehold);
    });

    testWidgets('the code is prefilled into the field', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, null);

      await _link(tester, harness, 'parimaan://join?code=k4m9pq');

      expect(_codeInBoxes(tester), 'K4M9PQ');
    });

    testWidgets(
      'it NEVER auto-joins — the mutation is untouched until the user taps',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(tester, null);

        await _link(tester, harness, 'parimaan://join?code=K4M9PQ');

        expect(
          harness.repository.joinCalls,
          isEmpty,
          reason:
              'a link that joined on tap would be a one-click '
              'account-linking attack',
        );

        // The explicit tap is what joins.
        await tester.tap(find.byKey(EnterCodeScreen.joinButtonKey));
        await tester.pumpAndSettle();
        expect(harness.repository.joinCalls, <String>['K4M9PQ']);
      },
    );

    testWidgets('the pending code is consumed, so the flow does not re-arm', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, null);

      await _link(tester, harness, 'parimaan://join?code=K4M9PQ');
      expect(harness.container.read(pendingJoinCodeControllerProvider), isNull);

      // With the code consumed, the user can navigate away and stay away.
      harness.router.go(AppRoutes.firstRun);
      await tester.pumpAndSettle();
      expect(location(harness.router), AppRoutes.firstRun);
    });

    testWidgets('a malformed link is ignored entirely', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(tester, null);

      for (final String uri in <String>[
        'evil://join?code=K4M9PQ',
        'https://evil.example/join?code=K4M9PQ',
        'parimaan://join?code=ABC',
        'parimaan://delete?code=K4M9PQ',
      ]) {
        await _link(tester, harness, uri);

        expect(
          location(harness.router),
          AppRoutes.firstRun,
          reason: '$uri must not move the app anywhere',
        );
      }
    });
  });

  // ── The property this whole mechanism has to satisfy ──────────────────────
  group('deep link — signed out: the guard is not bypassed', () {
    testWidgets(
      'a join link received while signed out lands on /sign-in, not /join',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          null,
          session: const AuthSession.signedOut(),
        );
        expect(location(harness.router), AppRoutes.signIn);

        await _link(tester, harness, 'parimaan://join?code=K4M9PQ');

        expect(
          location(harness.router),
          AppRoutes.signIn,
          reason: 'arming a pending code must not authenticate anyone',
        );
      },
    );

    testWidgets(
      'the join screen is not reachable by direct navigation either, even '
      'with a code armed',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          null,
          session: const AuthSession.signedOut(),
        );

        await _link(tester, harness, 'parimaan://join?code=K4M9PQ');
        harness.router.go(AppRoutes.joinHousehold);
        await tester.pumpAndSettle();

        expect(location(harness.router), AppRoutes.signIn);
      },
    );

    testWidgets('no join is attempted while signed out', (
      WidgetTester tester,
    ) async {
      final HouseholdHarness harness = await pumpHouseholdRoute(
        tester,
        null,
        session: const AuthSession.signedOut(),
      );

      await _link(tester, harness, 'parimaan://join?code=K4M9PQ');

      expect(harness.repository.joinCalls, isEmpty);
    });

    testWidgets(
      'the code survives the sign-in bounce and the flow RESUMES afterwards',
      (WidgetTester tester) async {
        final HouseholdHarness harness = await pumpHouseholdRoute(
          tester,
          null,
          session: const AuthSession.signedOut(),
        );

        await _link(tester, harness, 'parimaan://join?code=K4M9PQ');
        expect(location(harness.router), AppRoutes.signIn);

        // The code is held in state, not in the URL — which is the only
        // reason it can outlive a redirect that discarded the URL.
        expect(
          harness.container.read(pendingJoinCodeControllerProvider),
          'K4M9PQ',
        );

        // Now sign in, through the same session stream the real Cognito Hub
        // pushes through. The resume happens inside the guard's
        // already-signed-in branch, so it is a resume and never a bypass.
        harness.sessions.add(testSignedInSession);
        await tester.pumpAndSettle();

        expect(location(harness.router), AppRoutes.joinHousehold);
        expect(_codeInBoxes(tester), 'K4M9PQ');
        expect(
          harness.repository.joinCalls,
          isEmpty,
          reason: 'resuming still requires the explicit tap',
        );
      },
    );
  });
}
