import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/household.dart';
import '../../domain/household_name.dart';
import '../../state/create_household_controller.dart';
import '../../state/household_wizard_controller.dart';
import 'wizard_error_copy.dart';
import 'wizard_step_scaffold.dart';

/// Wireframe screen 2.1 — "Name household".
///
/// **This is the screen that actually creates the household.** Per the locked
/// "create at step 1, patch per step" decision, the household and its invite
/// code exist the moment Continue succeeds here; the five screens after this
/// one each `updateHouseholdSettings` against it. The alternative — collecting
/// all six screens and creating at the end — would mean a user who abandons on
/// screen 2.5 has nothing, and would put six screens' worth of failure modes
/// behind one button.
///
/// It dispatches through `CreateHouseholdController`, which already owns this
/// mutation, and then hands the result to `HouseholdWizardController` via
/// `adoptHousehold`. Two controllers rather than one because duplicating the
/// create path into the wizard would give the app two ways to create a
/// household — see the wizard controller's `adoptHousehold` doc.
class NameHouseholdScreen extends ConsumerStatefulWidget {
  const NameHouseholdScreen({super.key});

  static const Key nameFieldKey = Key('name-household-field');
  static const Key continueButtonKey = Key('name-household-continue');
  static const Key coldStartHintKey = Key('name-household-cold-start');

  /// Uppercase because the wireframe draws the field label as a meta label;
  /// `PInput` renders whatever string it is given.
  static const String fieldLabel = 'HOUSEHOLD NAME';
  static const String fieldHint = 'The Kulkarnis';
  static const String fieldHelper = 'You can rename it anytime.';

  /// Copy `PButton` swaps in for the label while the mutation is in flight.
  static const String continueLoadingLabel = 'Setting up your kitchen…';

  /// Aurora Serverless v2 auto-pause (PRD §17.4 lever #2) means the first
  /// request after a quiet period blocks for up to ~30s while the cluster
  /// resumes. A bare spinner reads as a hang at that duration, and a user who
  /// force-quits mid-mutation is the worst outcome available — so the wait is
  /// named. Same copy and same reasoning as `FirstRunChoosePathScreen`'s.
  static const String coldStartHint =
      'This can take up to half a minute the first time — the kitchen is '
      'waking up. Please keep the app open.';

  @override
  ConsumerState<NameHouseholdScreen> createState() =>
      _NameHouseholdScreenState();
}

class _NameHouseholdScreenState extends ConsumerState<NameHouseholdScreen> {
  final TextEditingController _name = TextEditingController();

  /// The client-side validation message, or `null`. Set only on submit and
  /// cleared on edit — validating every keystroke would shout "must not be
  /// empty" at someone who has simply not started typing.
  String? _validationError;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _onNameChanged(String _) {
    if (_validationError != null) {
      setState(() => _validationError = null);
    }
  }

  Future<void> _continue() async {
    // Fast feedback only. The server remains the authority and still gets
    // called for everything this does not catch — see `household_name.dart`.
    final String? error = validateHouseholdName(_name.text);
    if (error != null) {
      setState(() => _validationError = error);
      return;
    }
    setState(() => _validationError = null);

    await ref
        .read(createHouseholdControllerProvider.notifier)
        .createHousehold(_name.text);

    if (!mounted) {
      return;
    }
    final Household? created = ref
        .read(createHouseholdControllerProvider)
        .valueOrNull;
    if (created == null) {
      return;
    }

    // Awaited before adopting: `HouseholdWizardController.build()` is
    // `async`, so on this screen's first-ever touch of the provider (this is
    // the only place in the whole screen that reads it) its `state` is still
    // `AsyncLoading` for at least one microtask — and `adoptHousehold`'s
    // `_updateDraft` silently no-ops against a `null` current draft. Calling
    // `adoptHousehold` before that microtask turn has passed drops the
    // household on the floor: the wizard's own default `build()` result
    // then lands moments later and becomes the state instead, leaving every
    // later step's `_submit` with no `householdId` to patch — exactly the
    // failure `HouseholdEditEntry.hydrateFrom` already guards against with
    // this same await; this is the second call site that needed it.
    await ref.read(householdWizardControllerProvider.future);
    if (!mounted) {
      return;
    }
    ref
        .read(householdWizardControllerProvider.notifier)
        .adoptHousehold(created);
    context.go(AppRoutes.createHouseholdMeals);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<Household?> state = ref.watch(
      createHouseholdControllerProvider,
    );
    final bool isBusy = state.isLoading;

    return WizardStepScaffold(
      topBarTitle: 'New household',
      onBack: () => context.go(AppRoutes.firstRun),
      backSemanticLabel: 'Back to setting up your kitchen',
      errorMessage: wizardErrorMessage(state.error),
      action: PButton(
        key: NameHouseholdScreen.continueButtonKey,
        label: 'Continue',
        // `PButton`'s own loading affordance — spinner, swapped label, inert.
        // Reused rather than reinvented.
        isLoading: isBusy,
        loadingLabel: NameHouseholdScreen.continueLoadingLabel,
        expand: true,
        onPressed: _continue,
      ),
      children: <Widget>[
        PInput(
          key: NameHouseholdScreen.nameFieldKey,
          label: NameHouseholdScreen.fieldLabel,
          hintText: NameHouseholdScreen.fieldHint,
          helperText: NameHouseholdScreen.fieldHelper,
          errorText: _validationError,
          controller: _name,
          enabled: !isBusy,
          autofocus: true,
          textInputAction: TextInputAction.done,
          onChanged: _onNameChanged,
          onSubmitted: (String _) => _continue(),
        ),
        if (isBusy) ...<Widget>[
          const SizedBox(height: AppSpacing.s3),
          Text(
            NameHouseholdScreen.coldStartHint,
            key: NameHouseholdScreen.coldStartHintKey,
            style: AppTypography.label.copyWith(color: AppColors.inkSoft),
          ),
        ],
      ],
    );
  }
}
