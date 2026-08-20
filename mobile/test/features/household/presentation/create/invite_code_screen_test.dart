import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/app/router.dart';
import 'package:mobile/features/household/presentation/create/invite_code_screen.dart';
import 'package:mobile/shared/ui/components/components.dart';

import '../../../../support/wizard_harness.dart';

Future<WizardHarness> _pump(
  WidgetTester tester, {
  bool adoptHousehold = true,
}) => pumpWizardRoute(
  tester,
  AppRoutes.createHouseholdInvite,
  adoptHousehold: adoptHousehold,
);

/// Captures whatever the screen writes to the clipboard.
///
/// `Clipboard.setData` is a platform-channel call, which does nothing in a
/// widget test unless the channel is mocked — so without this the copy
/// assertions would silently pass against a no-op.
List<String> _interceptClipboard(WidgetTester tester) {
  final List<String> written = <String>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (MethodCall call) async {
      if (call.method == 'Clipboard.setData') {
        written.add(
          (call.arguments as Map<Object?, Object?>)['text']! as String,
        );
      }
      return null;
    },
  );
  addTearDown(
    () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    ),
  );
  return written;
}

void main() {
  group('InviteCodeScreen — rendering', () {
    testWidgets('renders the wireframe copy and the code itself', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.text(InviteCodeScreen.headline), findsOne);
      expect(find.text(InviteCodeScreen.subhead), findsOne);
      expect(find.byKey(InviteCodeScreen.codeKey), findsOne);
      expect(find.text('ABC123'), findsOne);
    });

    testWidgets('the code is rendered in the mono face, tracked', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      final Text code = tester.widget<Text>(
        find.byKey(InviteCodeScreen.codeKey),
      );
      expect(code.style?.fontFamily, 'JetBrains Mono');
      expect(code.style?.letterSpacing, greaterThan(0));
    });

    testWidgets('offers Copy, Share and a way onward', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(find.byKey(InviteCodeScreen.copyButtonKey), findsOne);
      expect(find.byKey(InviteCodeScreen.shareButtonKey), findsOne);
      expect(find.byKey(InviteCodeScreen.doneButtonKey), findsOne);
    });

    testWidgets(
      'reached without a household, it explains rather than showing a blank '
      'screen',
      (WidgetTester tester) async {
        await _pump(tester, adoptHousehold: false);

        expect(find.byKey(InviteCodeScreen.missingCodeKey), findsOne);
        expect(find.byKey(InviteCodeScreen.codeKey), findsNothing);
        expect(find.text('Set up a household'), findsOne);
      },
    );

    testWidgets('the missing-code state routes back to the start of setup', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester, adoptHousehold: false);

      await tester.tap(find.text('Set up a household'));
      await tester.pumpAndSettle();

      expect(currentLocation(harness.router), AppRoutes.createHouseholdName);
    });
  });

  group('InviteCodeScreen — copying', () {
    testWidgets('Copy puts the bare code on the clipboard', (
      WidgetTester tester,
    ) async {
      final List<String> clipboard = _interceptClipboard(tester);
      await _pump(tester);

      await tester.tap(find.byKey(InviteCodeScreen.copyButtonKey));
      await tester.pumpAndSettle();

      expect(clipboard, <String>['ABC123']);
    });

    testWidgets('Copy confirms with a toast', (WidgetTester tester) async {
      _interceptClipboard(tester);
      await _pump(tester);

      await tester.tap(find.byKey(InviteCodeScreen.copyButtonKey));
      await tester.pump();
      await tester.pump();

      expect(find.byType(PToast), findsOne);
      expect(find.text(InviteCodeScreen.copiedToast), findsOne);

      await tester.pumpAndSettle(InviteCodeScreen.toastDuration);
    });

    testWidgets(
      'Share also copies — a native share sheet needs a dependency this slice '
      'does not add — but with a shareable sentence and its own toast',
      (WidgetTester tester) async {
        final List<String> clipboard = _interceptClipboard(tester);
        await _pump(tester);

        await tester.tap(find.byKey(InviteCodeScreen.shareButtonKey));
        await tester.pump();
        await tester.pump();

        expect(clipboard, <String>[InviteCodeScreen.shareMessage('ABC123')]);
        expect(clipboard.single, contains('ABC123'));
        expect(find.text(InviteCodeScreen.sharedToast), findsOne);

        await tester.pumpAndSettle(InviteCodeScreen.toastDuration);
      },
    );
  });

  group('InviteCodeScreen — moving on', () {
    testWidgets('Done leaves the wizard for the home placeholder', (
      WidgetTester tester,
    ) async {
      final harness = await _pump(tester);

      await tester.tap(find.byKey(InviteCodeScreen.doneButtonKey));
      await tester.pumpAndSettle();

      expect(currentLocation(harness.router), AppRoutes.home);
    });
  });
}
