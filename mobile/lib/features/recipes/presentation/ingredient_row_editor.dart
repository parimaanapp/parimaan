import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../shared/input/quantity_input_formatter.dart';
import '../../../shared/ui/colors.dart';
import '../../catalog/domain/catalog_ingredient.dart';
import '../../catalog/presentation/ingredient_picker_field.dart';
import '../../pantry/domain/category_units.dart';
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
    this.catalogIngredient,
    required this.onCatalogSelected,
    required this.onAddAsNew,
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

  /// The catalog row this ingredient was picked as, or `null` for free text.
  /// Only honoured while the name text still equals its canonical name (a
  /// hand edit makes the row free text again) — see [selectionFor].
  final CatalogIngredient? catalogIngredient;

  /// The user picked a catalog match; the screen stores it and applies the
  /// default unit.
  final ValueChanged<CatalogIngredient> onCatalogSelected;

  /// The user chose "Add as new ingredient" for the typed name.
  final ValueChanged<String> onAddAsNew;

  static Key nameFieldKey(int index) => Key('ingredient-row-name-$index');
  static Key quantityFieldKey(int index) =>
      Key('ingredient-row-quantity-$index');
  static Key unitFieldKey(int index) => Key('ingredient-row-unit-$index');
  static Key unitChipKey(int index, String unit) =>
      Key('ingredient-row-unit-$index-$unit');
  static Key stapleChipKey(int index) => Key('ingredient-row-staple-$index');
  static Key removeButtonKey(int index) => Key('ingredient-row-remove-$index');

  @override
  Widget build(BuildContext context) => PCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: IngredientPickerField(
                fieldKey: nameFieldKey(index),
                controller: nameController,
                hintText: 'Toor dal',
                enabled: enabled,
                errorText: nameErrorText,
                onSelected: onCatalogSelected,
                onAddAsNew: onAddAsNew,
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
        ListenableBuilder(
          listenable: Listenable.merge(<Listenable>[
            nameController,
            unitController,
          ]),
          builder: (BuildContext context, Widget? _) {
            final CatalogIngredient? catalog = selectionFor(
              catalogIngredient,
              nameController.text,
            );
            return _QuantityAndUnits(
              index: index,
              quantityController: quantityController,
              unitController: unitController,
              enabled: enabled,
              catalog: catalog,
            );
          },
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

/// Quantity, unit entry and unit chips for one row. Wraps (never a
/// fixed-width row of chips), so at 320pt or 2x text every unit label stays
/// whole on its own line instead of being clipped or pushed off screen.
///
/// With a [catalog] row the chips are limited to its allowed units (default
/// first) and the free-text unit field is dropped — the catalog bounds the
/// choice. Free text keeps the field and the full recipe unit list.
class _QuantityAndUnits extends StatelessWidget {
  const _QuantityAndUnits({
    required this.index,
    required this.quantityController,
    required this.unitController,
    required this.enabled,
    required this.catalog,
  });

  final int index;
  final TextEditingController quantityController;
  final TextEditingController unitController;
  final bool enabled;
  final CatalogIngredient? catalog;

  @override
  Widget build(BuildContext context) {
    final List<String> units = unitsForIngredient(
      catalog,
      fallback: recipeUnits,
      // Free text keeps the plain list; typing a half-unit must not mint a chip.
      current: catalog == null ? null : unitController.text,
    );
    final String current = unitController.text.trim().toLowerCase();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: AppSpacing.s1,
          runSpacing: AppSpacing.s1,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: <Widget>[
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 120, maxWidth: 200),
              child: PInput(
                key: IngredientRowEditor.quantityFieldKey(index),
                label: 'Quantity',
                hintText: '2',
                controller: quantityController,
                enabled: enabled,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: <TextInputFormatter>[QuantityInputFormatter()],
                useMonoFont: true,
              ),
            ),
            if (catalog == null)
              ConstrainedBox(
                constraints: const BoxConstraints(minWidth: 120, maxWidth: 200),
                child: PInput(
                  key: IngredientRowEditor.unitFieldKey(index),
                  label: 'Unit',
                  // Neutral placeholder: a real unit name here read as a
                  // chosen value on a blank unit.
                  hintText: 'unit',
                  controller: unitController,
                  enabled: enabled,
                ),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.s1),
        Wrap(
          spacing: AppSpacing.s1,
          runSpacing: AppSpacing.s1,
          children: <Widget>[
            for (final String unit in units)
              PChip(
                key: IngredientRowEditor.unitChipKey(index, unit),
                label: unit,
                selected: current == unit.toLowerCase(),
                onTap: enabled ? () => unitController.text = unit : null,
              ),
          ],
        ),
      ],
    );
  }
}
