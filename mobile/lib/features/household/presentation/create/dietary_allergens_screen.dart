import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../domain/dietary_tag.dart';
import '../../state/household_wizard_controller.dart';
import 'wizard_error_copy.dart';
import 'wizard_flow.dart';
import 'wizard_step_scaffold.dart';
import 'wizard_step_submit.dart';

/// Wireframe screen 2.6 — dietary tags, allergens and skip ingredients,
/// step 4/4.
///
/// The **last** wizard step: a successful "Finish setup" navigates to the
/// invite-code screen. Also the only step that patches three fields at once —
/// they are one screen and one decision, so splitting them into three round
/// trips would be three chances to half-fail.
///
/// Dietary is a closed enum; allergens and skip ingredients are free text
/// (`[String!]`, no enum server-side), which is why they get an input and
/// removable chips rather than a fixed chip set.
class DietaryAllergensScreen extends ConsumerStatefulWidget {
  const DietaryAllergensScreen({
    super.key,
    this.flow = const WizardFlowContext.create(),
  });

  /// Whether this screen is a wizard step or a Settings edit. See
  /// `wizard_flow.dart` — defaults to the create wizard, so the wizard's
  /// own routes are unchanged.
  final WizardFlowContext flow;

  static const Key finishButtonKey = Key('dietary-finish');
  static const Key allergenFieldKey = Key('dietary-allergen-field');
  static const Key skipFieldKey = Key('dietary-skip-field');

  static Key tagKey(DietaryTag tag) => Key('dietary-tag-${tag.name}');
  static Key allergenChipKey(String value) => Key('dietary-allergen-$value');
  static Key skipChipKey(String value) => Key('dietary-skip-$value');

  static const String stepIndicator = '4/4';
  static const String finishLabel = 'Finish setup';

  @override
  ConsumerState<DietaryAllergensScreen> createState() =>
      _DietaryAllergensScreenState();
}

class _DietaryAllergensScreenState
    extends ConsumerState<DietaryAllergensScreen> {
  /// Owned here rather than in the controller: these hold *in-progress typing*,
  /// not a decision. A half-typed "pea" is not a preference, and putting it in
  /// the wizard draft would mean a rebuild per keystroke for a value nothing
  /// else reads.
  final TextEditingController _allergen = TextEditingController();
  final TextEditingController _skip = TextEditingController();

  @override
  void dispose() {
    _allergen.dispose();
    _skip.dispose();
    super.dispose();
  }

  void _addAllergen() {
    // Blank and duplicate handling lives in the controller (`_appended`), so
    // this can submit unconditionally and clear.
    ref
        .read(householdWizardControllerProvider.notifier)
        .addAllergen(_allergen.text);
    _allergen.clear();
  }

  void _addSkip() {
    ref
        .read(householdWizardControllerProvider.notifier)
        .addSkipIngredient(_skip.text);
    _skip.clear();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<HouseholdWizardData> state = ref.watch(
      householdWizardControllerProvider,
    );
    final HouseholdWizardData? draft = state.valueOrNull;
    final HouseholdWizardController controller = ref.read(
      householdWizardControllerProvider.notifier,
    );
    final bool isBusy = state.isLoading;

    return WizardStepScaffold(
      stepIndicator: widget.flow.stepIndicator(
        DietaryAllergensScreen.stepIndicator,
      ),
      onBack: () => context.go(
        widget.flow.backDestination(
          whenCreating: AppRoutes.createHouseholdCuisineBias,
        ),
      ),
      backSemanticLabel: widget.flow.backSemanticLabel(
        whenCreating: 'Back to the sub-cuisine mix',
      ),
      errorMessage: wizardErrorMessage(state.error),
      action: PButton(
        key: DietaryAllergensScreen.finishButtonKey,
        label: widget.flow.isEditing
            ? widget.flow.actionLabel
            : DietaryAllergensScreen.finishLabel,
        isLoading: isBusy,
        expand: true,
        onPressed: draft == null
            ? null
            : () => submitWizardStep(
                ref: ref,
                context: context,
                submit: (HouseholdWizardController c) =>
                    c.submitDietaryAndAllergens(),
                nextRoute: widget.flow.destination(
                  whenCreating: AppRoutes.createHouseholdInvite,
                ),
              ),
      ),
      children: <Widget>[
        const WizardSectionLabel(label: 'Dietary'),
        Wrap(
          spacing: AppSpacing.s1,
          runSpacing: AppSpacing.s1,
          children: <Widget>[
            for (final DietaryTag tag in DietaryTag.values)
              PChip(
                key: DietaryAllergensScreen.tagKey(tag),
                label: tag.displayLabel,
                selected: draft?.dietaryTags.contains(tag) ?? false,
                onTap: isBusy ? null : () => controller.toggleDietaryTag(tag),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.s4),

        const WizardSectionLabel(label: 'Allergens'),
        _FreeTextAdder(
          fieldKey: DietaryAllergensScreen.allergenFieldKey,
          label: 'Add an allergen',
          hint: 'Peanut',
          controller: _allergen,
          enabled: !isBusy,
          onAdd: _addAllergen,
        ),
        const SizedBox(height: AppSpacing.s1),
        _RemovableChips(
          values: draft?.allergens ?? const <String>[],
          keyFor: DietaryAllergensScreen.allergenChipKey,
          noun: 'allergen',
          onRemove: isBusy ? null : controller.removeAllergen,
        ),
        const SizedBox(height: AppSpacing.s4),

        const WizardSectionLabel(label: 'Skip ingredients'),
        _FreeTextAdder(
          fieldKey: DietaryAllergensScreen.skipFieldKey,
          label: 'Add an ingredient to skip',
          hint: 'Mustard oil',
          controller: _skip,
          enabled: !isBusy,
          onAdd: _addSkip,
        ),
        const SizedBox(height: AppSpacing.s1),
        _RemovableChips(
          values: draft?.skipIngredients ?? const <String>[],
          keyFor: DietaryAllergensScreen.skipChipKey,
          noun: 'skipped ingredient',
          onRemove: isBusy ? null : controller.removeSkipIngredient,
        ),
      ],
    );
  }
}

/// A [PInput] with an Add button in its trailing slot.
///
/// The wireframe draws a dashed "＋ add allergen" placeholder box, which is a
/// picture of an interaction rather than a control: tapping it has to produce
/// a text field eventually. This is that field, shown directly. `PInput`'s
/// `trailing` slot exists for exactly this kind of adjacent control — see its
/// doc — so no new pattern is invented.
class _FreeTextAdder extends StatelessWidget {
  const _FreeTextAdder({
    required this.fieldKey,
    required this.label,
    required this.hint,
    required this.controller,
    required this.enabled,
    required this.onAdd,
  });

  final Key fieldKey;
  final String label;
  final String hint;
  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) => PInput(
    key: fieldKey,
    label: label,
    hintText: hint,
    controller: controller,
    enabled: enabled,
    textInputAction: TextInputAction.done,
    onSubmitted: (String _) => onAdd(),
    trailing: PButton(
      label: 'Add',
      variant: PButtonVariant.secondary,
      size: PButtonSize.small,
      onPressed: enabled ? onAdd : null,
    ),
  );
}

/// The list of already-added free-text values, each with a `×`.
class _RemovableChips extends StatelessWidget {
  const _RemovableChips({
    required this.values,
    required this.keyFor,
    required this.noun,
    required this.onRemove,
  });

  final List<String> values;
  final Key Function(String value) keyFor;

  /// Used to build each chip's remove label — "Remove peanut, an allergen"
  /// reads far better to a screen reader than a bare "×".
  final String noun;

  final ValueChanged<String>? onRemove;

  @override
  Widget build(BuildContext context) {
    if (values.isEmpty) {
      return const SizedBox.shrink();
    }
    return Wrap(
      spacing: AppSpacing.s1,
      runSpacing: AppSpacing.s1,
      children: <Widget>[
        for (final String value in values)
          PChip(
            key: keyFor(value),
            label: value,
            variant: PChipVariant.tag,
            onRemove: onRemove == null ? null : () => onRemove!(value),
            removeSemanticLabel: onRemove == null
                ? null
                : 'Remove $value, $noun',
          ),
      ],
    );
  }
}
