import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../domain/household.dart';
import '../../state/current_household_controller.dart';
import '../../state/household_wizard_controller.dart';
import '../create/wizard_flow.dart';
import '../household_error_copy.dart';

/// Loads a household, seeds the wizard draft from it, then renders one of the
/// wizard's own screens in [WizardFlow.edit].
///
/// This is the adapter that makes the Settings rows reuse wizard screens
/// 2.3–2.6 instead of duplicating them. It exists because those screens read
/// their content from `householdWizardControllerProvider`, and in the create
/// flow that draft is built up step by step — whereas a screen opened from
/// Settings has no such history and must start from what the server stores.
///
/// So this widget does the two things the wizard screens cannot do for
/// themselves:
///
///  1. **Wait for the household.** The wizard screens assume a draft is
///     already there; here it has to be fetched first, and the fetch can fail.
///  2. **Hydrate the draft exactly once.** `hydrateFrom` replaces the whole
///     draft, so calling it on every rebuild would discard the user's in-
///     progress edits on the first keystroke. The [_hydratedFor] guard is what
///     makes it once-per-household rather than once-per-frame.
///
/// The wizard screen itself is passed in as [builder] rather than switched on
/// here, so adding a sixth editable preference is a route entry and nothing
/// else.
class HouseholdEditEntry extends ConsumerStatefulWidget {
  const HouseholdEditEntry({
    super.key,
    required this.householdId,
    required this.builder,
  });

  final String householdId;

  /// Builds the wizard screen, given the edit-flow context to hand it.
  final Widget Function(WizardFlowContext flow) builder;

  @override
  ConsumerState<HouseholdEditEntry> createState() => _HouseholdEditEntryState();
}

class _HouseholdEditEntryState extends ConsumerState<HouseholdEditEntry> {
  /// The household id whose settings have already been loaded into the draft.
  ///
  /// Not a `bool`: a user who navigates from one household's settings to
  /// another's within the same session must re-hydrate, and a flag would leave
  /// the second household showing the first one's preferences.
  String? _hydratedFor;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Household> household = ref.watch(
      currentHouseholdControllerProvider(widget.householdId),
    );

    final Household? value = household.valueOrNull;
    if (value != null && _hydratedFor != value.id) {
      _hydratedFor = value.id;
      // Deferred past this frame: `hydrateFrom` writes to another provider,
      // which must not happen during a build.
      //
      // And awaited on the wizard controller's own `build()` first. That
      // notifier builds *asynchronously*, and `hydrateFrom` is a plain `state =`
      // assignment — so hydrating before the build resolves lets the build's
      // fresh default draft land afterwards and silently clobber the
      // hydration, leaving the screen showing wizard defaults for a household
      // whose real settings had already been fetched.
      WidgetsBinding.instance.addPostFrameCallback((Duration _) async {
        await ref.read(householdWizardControllerProvider.future);
        if (mounted) {
          ref
              .read(householdWizardControllerProvider.notifier)
              .hydrateFrom(value);
        }
      });
    }

    if (value == null) {
      return Scaffold(
        backgroundColor: AppColors.paper,
        body: SafeArea(
          child: switch (household) {
            AsyncValue<Household>(:final Object error?) => Center(
              child: PEmptyState(
                headline: 'Could not load these settings',
                body: householdErrorMessage(error) ?? '',
                action: PButton(
                  label: 'Back to settings',
                  variant: PButtonVariant.secondary,
                  onPressed: () =>
                      context.go(AppRoutes.settingsHub(widget.householdId)),
                ),
              ),
            ),
            _ => const Center(child: CircularProgressIndicator()),
          },
        ),
      );
    }

    // The draft is hydrated one frame behind the first build with a value. The
    // wizard screens all render safely from a default draft in the meantime —
    // they already handle `draft == null` during the notifier's own first
    // build — so this shows preferences that are correct from the second frame
    // rather than flashing a spinner for one.
    return widget.builder(WizardFlowContext.edit(widget.householdId));
  }
}
