// Boot-level smoke test for the whole app shell.
//
// Screen- and redirect-level behaviour is covered by `test/app/router_test.dart`
// and the per-screen tests under `test/features/auth/presentation/`. What is
// only testable here is that `ParimaanApp` itself wires ProviderScope, the
// router and the theme together and reaches a real screen.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/app.dart';
import 'package:mobile/features/auth/data/auth_repository.dart';
import 'package:mobile/shared/graphql/client.dart';
import 'package:mobile/shared/graphql/subscription_client.dart';
import 'package:mobile/shared/ui/colors.dart';
import 'package:mobile/shared/ui/components/offline_banner.dart';

import 'support/fake_auth_repository.dart';

/// `_RoutedApp`'s `builder` unconditionally reads `subscriptionClientProvider`
/// now (W12 S7, `OfflineBanner` mounted at the app root) — every boot test
/// needs a real instance, even signed-out ones that never reach a screen
/// that itself uses GraphQL. Never `subscribe()`d, so it never opens a
/// socket; its `connectionState` simply stays at the default `disconnected`
/// value, which is harmless here since no test in this file waits past
/// `offlineBannerDebounce`.
List<Override> _withSubscriptionClient(List<Override> overrides) {
  return <Override>[
    ...overrides,
    subscriptionClientProvider.overrideWith((Ref ref) {
      final AppSyncSubscriptionClient client = AppSyncSubscriptionClient(
        httpGraphQlUrl: 'https://example.invalid/graphql',
        idTokenProvider: () async => 'fake-token',
      );
      // Matches the production override's own disposal wiring
      // (`client.dart`'s `ferryClientOverride`) — a no-op here since this
      // client never calls `subscribe()`, but kept for consistency in case
      // this helper is ever reused somewhere that does.
      ref.onDispose(client.disconnect);
      return client;
    }),
  ];
}

void main() {
  testWidgets('boots to the sign-in screen when signed out', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ParimaanApp(
        overrides: _withSubscriptionClient(<Override>[
          authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
        ]),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Continue with Google'), findsOneWidget);
  });

  testWidgets('boots to the first-run screen when already signed in', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ParimaanApp(
        overrides: _withSubscriptionClient(<Override>[
          authRepositoryProvider.overrideWithValue(
            stubbedAuthRepository(session: testSignedInSession),
          ),
        ]),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Set up your kitchen'), findsOneWidget);
  });

  testWidgets('applies the Parimaan theme rather than the Material default', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ParimaanApp(
        overrides: _withSubscriptionClient(<Override>[
          authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
        ]),
      ),
    );
    await tester.pumpAndSettle();

    final BuildContext context = tester.element(
      find.text('Continue with Google'),
    );
    expect(Theme.of(context).colorScheme.primary, AppColors.terracotta);
    expect(Theme.of(context).scaffoldBackgroundColor, AppColors.paper);
  });

  testWidgets(
    'mounts OfflineBanner exactly once at the app root, across different '
    'initial routes (signed-out vs. signed-in) rather than being wired '
    'per-screen',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        ParimaanApp(
          overrides: _withSubscriptionClient(<Override>[
            authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
          ]),
        ),
      );
      await tester.pumpAndSettle();

      // Signed-out route (sign-in screen).
      expect(find.byType(OfflineBanner), findsOneWidget);

      await tester.pumpWidget(
        ParimaanApp(
          overrides: _withSubscriptionClient(<Override>[
            authRepositoryProvider.overrideWithValue(
              stubbedAuthRepository(session: testSignedInSession),
            ),
          ]),
        ),
      );
      await tester.pumpAndSettle();

      // Different route (first-run/signed-in screen) — still exactly one
      // `OfflineBanner`, proving it lives at the app root rather than being
      // wired per-screen.
      expect(find.byType(OfflineBanner), findsOneWidget);
    },
  );
}
