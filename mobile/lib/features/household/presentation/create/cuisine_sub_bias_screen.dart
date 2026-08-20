import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router.dart';
import '../../../../shared/ui/colors.dart';
import '../../../../shared/ui/components/components.dart';
import '../../../../shared/ui/spacing.dart';
import '../../../../shared/ui/typography.dart';
import '../../domain/cuisine_taxonomy.dart';
import '../../state/household_wizard_controller.dart';
import 'wizard_error_copy.dart';
import 'wizard_step_scaffold.dart';
import 'wizard_step_submit.dart';

/// Wireframe screen 2.5 — sub-cuisines and their Less / Same / More bias.
///
/// Still step **3/4**: the wireframe gives 2.4 and 2.5 the same indicator
/// because they are one logical step split across two frames, and this keeps
/// that promise rather than quietly turning a four-step wizard into five.
///
/// One section per selected Tier 1 region that has documented sub-cuisines.
/// Three of the five regions have none (`docs/PRD.md` §7.3 documents no
/// sub-taxonomy for Pan-India, Indo-Chinese or Continental, and none is
/// invented) — so a household that picked only those sees the empty state
/// below rather than a blank screen.
class CuisineSubBiasScreen extends ConsumerWidget {
  const CuisineSubBiasScreen({super.key});

  static const Key continueButtonKey = Key('cuisine-bias-continue');
  static const Key emptyStateKey = Key('cuisine-bias-empty');

  static Key biasKey(String subCuisineKey, CuisineBias bias) =>
      Key('cuisine-bias-$subCuisineKey-${bias.name}');

  static const String stepIndicator = '3/4';
  static const String heading = 'Sub-cuisines';
  static const String hint = 'Nudge the mix — this biases, it never filters';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<HouseholdWizardData> state = ref.watch(
      householdWizardControllerProvider,
    );
    final HouseholdWizardData? draft = state.valueOrNull;
    final bool isBusy = state.isLoading;

    return WizardStepScaffold(
      stepIndicator: stepIndicator,
      heading: heading,
      hint: hint,
      onBack: () => context.go(AppRoutes.createHouseholdCuisine),
      backSemanticLabel: 'Back to the cuisine regions',
      errorMessage: wizardErrorMessage(state.error),
      action: PButton(
        key: continueButtonKey,
        label: 'Continue',
        isLoading: isBusy,
        expand: true,
        onPressed: draft == null
            ? null
            : () => submitWizardStep(
                ref: ref,
                context: context,
                submit: (HouseholdWizardController c) =>
                    c.submitCuisineSubAndBias(),
                nextRoute: AppRoutes.createHouseholdDietary,
              ),
      ),
      children: draft == null
          ? const <Widget>[]
          : _sections(context, ref, draft, isBusy: isBusy),
    );
  }

  List<Widget> _sections(
    BuildContext context,
    WidgetRef ref,
    HouseholdWizardData draft, {
    required bool isBusy,
  }) {
    final List<CuisineRegion> withSubs = CuisineRegion.values
        .where(draft.regions.contains)
        .where((CuisineRegion r) => subCuisinesOf(r).isNotEmpty)
        .toList(growable: false);

    if (withSubs.isEmpty) {
      return <Widget>[
        Padding(
          key: emptyStateKey,
          padding: const EdgeInsets.only(top: AppSpacing.s5),
          child: PEmptyState(
            headline: 'Nothing to fine-tune',
            body:
                'The regions you picked have no sub-cuisines yet. You can go '
                'back and add one, or carry on — nothing is lost either way.',
            action: PButton(
              label: 'Back to regions',
              variant: PButtonVariant.secondary,
              onPressed: () => context.go(AppRoutes.createHouseholdCuisine),
            ),
          ),
        ),
      ];
    }

    final HouseholdWizardController controller = ref.read(
      householdWizardControllerProvider.notifier,
    );

    return <Widget>[
      for (final CuisineRegion region in withSubs) ...<Widget>[
        WizardSectionLabel(label: 'Under ${region.displayLabel}'),
        for (final SubCuisine sub in subCuisinesOf(region)) ...<Widget>[
          _BiasRow(
            sub: sub,
            bias: draft.subCuisineWeights[sub.key] ?? CuisineBias.defaultBias,
            onChanged: isBusy
                ? null
                : (CuisineBias bias) => controller.setBias(sub.key, bias),
          ),
          const SizedBox(height: AppSpacing.s1),
        ],
        const SizedBox(height: AppSpacing.s2),
      ],
    ];
  }
}

/// One sub-cuisine and its three-way bias selector.
///
/// **Component gap, and what stands in for it.** The wireframe draws a
/// segmented control; `lib/shared/ui/components/` has no segmented control
/// (`PTabBar` is bottom navigation and takes `IconData`, so it is not one).
/// Three [PChip]s in filter variant are the closest existing pattern and are
/// a genuinely good fit: a filter chip is exactly "on/off, tappable, selection
/// shown by an inverted surface *and* a tick", which is what one segment is.
/// The alternative — a hand-built segmented control — would be a new visual
/// pattern invented inside a feature, which is what the design system exists
/// to prevent.
class _BiasRow extends StatelessWidget {
  const _BiasRow({
    required this.sub,
    required this.bias,
    required this.onChanged,
  });

  final SubCuisine sub;
  final CuisineBias bias;
  final ValueChanged<CuisineBias>? onChanged;

  @override
  Widget build(BuildContext context) => PCard(
    padding: const EdgeInsets.symmetric(
      horizontal: AppSpacing.s2,
      vertical: AppSpacing.s1,
    ),
    // A column, not the wireframe's single row: three 44pt-minimum chips plus
    // a label as long as "Andhra/Telangana" do not fit side by side at 375pt
    // without either overflowing or shrinking the chips below the touch-target
    // floor. Stacking keeps every rule intact and costs one line of height.
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          sub.displayLabel,
          style: AppTypography.body.copyWith(color: AppColors.ink),
        ),
        Row(
          children: <Widget>[
            for (final CuisineBias option in CuisineBias.values) ...<Widget>[
              PChip(
                key: CuisineSubBiasScreen.biasKey(sub.key, option),
                label: option.displayLabel,
                selected: option == bias,
                onTap: onChanged == null ? null : () => onChanged!(option),
              ),
              const SizedBox(width: AppSpacing.s0),
            ],
          ],
        ),
      ],
    ),
  );
}
