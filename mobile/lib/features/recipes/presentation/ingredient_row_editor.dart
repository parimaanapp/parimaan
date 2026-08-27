import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';

/// One editable ingredient row in `RecipeFormScreen`'s dynamic-length list
/// (W6 S8). Stateless by contract, same rule as `PInput`: the three
/// [TextEditingController]s are owned by the screen, not this widget, so
/// the screen's own single source of truth (needed for the create-vs-edit
/// diff, §12.2.4's replace-semantics detection) never has to be
/// reconciled against a second copy living in row state.
///
/// Deliberately does not expose `category`/`notes` — both exist on
/// `RecipeIngredientInput` and are fully supported by the domain/wire layer
/// ([RecipeIngredientDraft]), but no RED test in this slice's plan
/// (E2E_MVP_PLAN.md §12.3 S8) calls for editing them, and every additional
/// field is one more thing the dynamic-list-reorder mechanic (the slice's
/// actual point of uncertainty) has to carry correctly. A later slice can
/// add the fields without touching the list mechanics this one gets right.
/// `RecipeFormScreen`'s own `_IngredientRow` still round-trips both fields
/// unchanged (not through this widget) — `ingredients` is a whole-list-
/// replace patch field, so silently dropping them on every edit would erase
/// data on rows the user never touched, not just leave them un-editable.
///
/// [index] is this row's current position — used only to build stable
/// per-field `Key`s and to tell `ReorderableDragStartListener` which item a
/// drag started on. It is deliberately separate from this widget's own
/// [key] (a `ValueKey` on a stable row identity `ReorderableListView`
/// itself needs) — [index] changes on every reorder, a widget `key` must
/// not.
class IngredientRowEditor extends StatelessWidget {
  const IngredientRowEditor({
    super.key,
    required this.index,
    required this.nameController,
    required this.quantityController,
    required this.unitController,
    required this.isStaple,
    required this.onStapleChanged,
    required this.onRemove,
    required this.enabled,
    this.nameErrorText,
  });

  final int index;
  final TextEditingController nameController;
  final TextEditingController quantityController;
  final TextEditingController unitController;
  final bool isStaple;
  final ValueChanged<bool> onStapleChanged;
  final VoidCallback onRemove;
  final bool enabled;
  final String? nameErrorText;

  static Key nameFieldKey(int index) => Key('ingredient-row-name-$index');
  static Key quantityFieldKey(int index) =>
      Key('ingredient-row-quantity-$index');
  static Key unitFieldKey(int index) => Key('ingredient-row-unit-$index');
  static Key stapleChipKey(int index) => Key('ingredient-row-staple-$index');
  static Key removeButtonKey(int index) => Key('ingredient-row-remove-$index');

  @override
  Widget build(BuildContext context) => PCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: PInput(
                key: nameFieldKey(index),
                label: 'Ingredient',
                hintText: 'Toor dal',
                controller: nameController,
                enabled: enabled,
                errorText: nameErrorText,
              ),
            ),
            const SizedBox(width: AppSpacing.s1),
            ReorderableDragStartListener(
              index: index,
              child: Padding(
                padding: const EdgeInsets.only(top: AppSpacing.s2),
                child: Semantics(
                  label: 'Reorder ingredient',
                  child: Icon(
                    Icons.drag_handle,
                    color: AppColors.inkMid,
                    size: AppSizing.icon16,
                  ),
                ),
              ),
            ),
            PIconButton(
              key: removeButtonKey(index),
              icon: Icons.delete_outline,
              semanticLabel: 'Remove ingredient',
              variant: PButtonVariant.ghost,
              onPressed: enabled ? onRemove : null,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.s1),
        Row(
          children: <Widget>[
            Expanded(
              child: PInput(
                key: quantityFieldKey(index),
                label: 'Quantity',
                hintText: '2',
                controller: quantityController,
                enabled: enabled,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                useMonoFont: true,
              ),
            ),
            const SizedBox(width: AppSpacing.s1),
            Expanded(
              child: PInput(
                key: unitFieldKey(index),
                label: 'Unit',
                hintText: 'cup',
                controller: unitController,
                enabled: enabled,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.s1),
        PChip(
          key: stapleChipKey(index),
          label: 'Staple',
          selected: isStaple,
          onTap: enabled ? () => onStapleChanged(!isStaple) : null,
        ),
      ],
    ),
  );
}
