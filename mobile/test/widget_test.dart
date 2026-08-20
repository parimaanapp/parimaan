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
import 'package:mobile/shared/ui/colors.dart';

import 'support/fake_auth_repository.dart';

void main() {
  testWidgets('boots to the sign-in screen when signed out', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ParimaanApp(
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Continue with Google'), findsOneWidget);
  });

  testWidgets('boots to the home placeholder when already signed in', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ParimaanApp(
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(
            stubbedAuthRepository(session: testSignedInSession),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Signed in'), findsOneWidget);
  });

  testWidgets('applies the Parimaan theme rather than the Material default', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ParimaanApp(
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(stubbedAuthRepository()),
        ],
      ),
    );
    await tester.pumpAndSettle();

    final BuildContext context = tester.element(
      find.text('Continue with Google'),
    );
    expect(Theme.of(context).colorScheme.primary, AppColors.terracotta);
    expect(Theme.of(context).scaffoldBackgroundColor, AppColors.paper);
  });
}
