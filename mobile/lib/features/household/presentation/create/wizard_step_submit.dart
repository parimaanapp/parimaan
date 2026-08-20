import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../state/household_wizard_controller.dart';

/// Runs one wizard step's submit and advances to [nextRoute] only if it
/// succeeded.
///
/// The four screens that submit and move on all need the identical three
/// steps — call the controller, re-read the state, navigate or stay — and
/// getting *any* of them subtly wrong is a real bug: navigating
/// unconditionally would march the user forward past a `FORBIDDEN`, and
/// reading the state before the await would test the previous step's result.
///
/// `submitX` never throws (the wizard controller's contract), so the outcome
/// is read from `state`, not from a caught exception. The `context.mounted`
/// guard is not ceremony: an Aurora cold start can hold this future open for
/// ~30s, which is ample time for the user to navigate away.
Future<void> submitWizardStep({
  required WidgetRef ref,
  required BuildContext context,
  required Future<void> Function(HouseholdWizardController controller) submit,
  required String nextRoute,
}) async {
  await submit(ref.read(householdWizardControllerProvider.notifier));

  if (!context.mounted) {
    return;
  }
  if (ref.read(householdWizardControllerProvider).hasError) {
    return;
  }
  context.go(nextRoute);
}
