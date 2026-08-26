import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/pantry_category.dart';
import '../domain/pantry_item.dart';
import '../domain/pantry_item_draft.dart';
import '../domain/pantry_item_patch.dart';
import '../domain/pantry_item_validation.dart';
import '../state/pantry_form_controller.dart';
import 'pantry_error_copy.dart';

/// Wireframe screen 9.3 — Manual add, reused in edit mode.
///
/// One screen for both jobs, matching the precedent
/// `household_edit_entry.dart` sets for the wizard's settings-edit rows:
/// [initialItem] `null` means create (dispatches `addPantryItem`);
/// non-`null` means edit, seeded from that item (dispatches
/// `updatePantryItem` with only the fields the user actually changed —
/// E2E_MVP_PLAN.md §11.2.7). Unlike `HouseholdEditEntry` this needs no
/// async fetch-then-hydrate step: the item this screen edits is always
/// already in memory (the caller reached this screen by tapping a
/// `PantryRow` already rendered from the loaded list), so seeding happens
/// once, synchronously, in `initState`.
class ManualAddScreen extends ConsumerStatefulWidget {
  const ManualAddScreen({
    super.key,
    required this.householdId,
    this.initialItem,
  });

  final String householdId;
  final PantryItem? initialItem;

  static const Key nameFieldKey = Key('manual-add-name');
  static const Key quantityFieldKey = Key('manual-add-quantity');
  static const Key unitFieldKey = Key('manual-add-unit');
  static const Key categoryChipsKey = Key('manual-add-category');
  static const Key stapleChipKey = Key('manual-add-staple');
  static const Key expiryFieldKey = Key('manual-add-expiry');
  static const Key lowThresholdFieldKey = Key('manual-add-low-threshold');
  static const Key submitButtonKey = Key('manual-add-submit');

  bool get isEditMode => initialItem != null;

  @override
  ConsumerState<ManualAddScreen> createState() => _ManualAddScreenState();
}

class _ManualAddScreenState extends ConsumerState<ManualAddScreen> {
  late final TextEditingController _name;
  late final TextEditingController _quantity;
  late final TextEditingController _unit;
  late final TextEditingController _expiry;
  late final TextEditingController _lowThreshold;
  String? _category;
  bool _isStaple = false;

  @override
  void initState() {
    super.initState();
    final PantryItem? item = widget.initialItem;
    _name = TextEditingController(text: item?.name ?? '');
    _quantity = TextEditingController(
      text: item == null ? '' : _formatNumber(item.quantity),
    );
    _unit = TextEditingController(text: item?.unit ?? '');
    _expiry = TextEditingController(text: item?.expiryDate ?? '');
    _lowThreshold = TextEditingController(
      text: item?.lowThreshold == null ? '' : _formatNumber(item!.lowThreshold!),
    );
    _category = item?.category;
    _isStaple = item?.isStaple ?? false;
    for (final TextEditingController controller in <TextEditingController>[
      _name,
      _quantity,
      _unit,
      _expiry,
      _lowThreshold,
    ]) {
      controller.addListener(_onFieldChanged);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _quantity.dispose();
    _unit.dispose();
    _expiry.dispose();
    _lowThreshold.dispose();
    super.dispose();
  }

  void _onFieldChanged() => setState(() {});

  /// Drops a trailing `.0` — `2.0` reads oddly in a quantity field a user is
  /// about to edit further.
  static String _formatNumber(double value) =>
      value == value.roundToDouble() ? value.toInt().toString() : value.toString();

  double? _parseNumber(String text) {
    final String trimmed = text.trim();
    if (trimmed.isEmpty) {
      return null;
    }
    return double.tryParse(trimmed) ?? double.nan;
  }

  bool get _isValid {
    final double? quantity = _parseNumber(_quantity.text);
    return validatePantryItemName(_name.text) == null &&
        quantity != null &&
        validatePantryItemQuantity(quantity) == null &&
        validatePantryItemUnit(_unit.text) == null &&
        validatePantryItemExpiryDate(
              _expiry.text.trim().isEmpty ? null : _expiry.text.trim(),
            ) ==
            null;
  }

  Future<void> _submit() async {
    final PantryFormController controller = ref.read(
      pantryFormControllerProvider.notifier,
    );
    final String? expiry = _expiry.text.trim().isEmpty ? null : _expiry.text.trim();
    final double? lowThreshold = _parseNumber(_lowThreshold.text);
    final String? category = _category;

    final PantryItem? existing = widget.initialItem;
    final bool ok;
    if (existing == null) {
      ok = await controller.add(
        widget.householdId,
        PantryItemDraft(
          name: _name.text.trim(),
          quantity: _parseNumber(_quantity.text)!,
          unit: _unit.text.trim(),
          category: category,
          isStaple: _isStaple,
          expiryDate: expiry,
          lowThreshold: lowThreshold,
        ),
      );
    } else {
      final Map<String, Object?> changed = <String, Object?>{
        if (_name.text.trim() != existing.name) 'name': _name.text.trim(),
        if (_parseNumber(_quantity.text) != existing.quantity)
          'quantity': _parseNumber(_quantity.text),
        if (_unit.text.trim() != existing.unit) 'unit': _unit.text.trim(),
        if (category != existing.category) 'category': category,
        if (_isStaple != existing.isStaple) 'isStaple': _isStaple,
        if (expiry != existing.expiryDate) 'expiryDate': expiry,
        if (lowThreshold != existing.lowThreshold) 'lowThreshold': lowThreshold,
      };
      if (changed.isEmpty) {
        // Nothing to save — not an error, just nothing to send. Popping
        // matches what a successful no-op save would do.
        if (mounted) {
          Navigator.of(context).pop();
        }
        return;
      }
      ok = await controller.updateItem(
        existing.id,
        PantryItemPatch(
          name: changed['name'] as String?,
          quantity: changed['quantity'] as double?,
          unit: changed['unit'] as String?,
          category: changed['category'] as String?,
          isStaple: changed['isStaple'] as bool?,
          expiryDate: changed['expiryDate'] as String?,
          lowThreshold: changed['lowThreshold'] as double?,
        ),
      );
    }

    if (!mounted) {
      return;
    }
    if (ok) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> formState = ref.watch(pantryFormControllerProvider);
    final bool isBusy = formState.isLoading;
    final String? errorMessage = pantryErrorMessage(formState.error);

    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: widget.isEditMode ? 'Edit item' : 'Add item',
              onBack: () => Navigator.of(context).pop(),
              backSemanticLabel: 'Back to pantry',
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.s3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    PInput(
                      key: ManualAddScreen.nameFieldKey,
                      label: 'Name',
                      hintText: 'Toor dal',
                      controller: _name,
                      enabled: !isBusy,
                      autofocus: !widget.isEditMode,
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    PInput(
                      key: ManualAddScreen.quantityFieldKey,
                      label: 'Quantity',
                      hintText: '2',
                      controller: _quantity,
                      enabled: !isBusy,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      useMonoFont: true,
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    PInput(
                      key: ManualAddScreen.unitFieldKey,
                      label: 'Unit',
                      hintText: 'kg',
                      controller: _unit,
                      enabled: !isBusy,
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    Text(
                      'CATEGORY',
                      style: AppTypography.meta.copyWith(color: AppColors.inkMid),
                    ),
                    const SizedBox(height: AppSpacing.s1),
                    Wrap(
                      key: ManualAddScreen.categoryChipsKey,
                      spacing: AppSpacing.s1,
                      runSpacing: AppSpacing.s1,
                      children: <Widget>[
                        for (final String category in knownPantryCategories)
                          PChip(
                            label: pantryCategoryLabel(category),
                            selected: _category == category,
                            onTap: isBusy
                                ? null
                                : () => setState(
                                    () => _category =
                                        _category == category ? null : category,
                                  ),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    PChip(
                      key: ManualAddScreen.stapleChipKey,
                      label: 'Staple item',
                      selected: _isStaple,
                      onTap: isBusy
                          ? null
                          : () => setState(() => _isStaple = !_isStaple),
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    PInput(
                      key: ManualAddScreen.expiryFieldKey,
                      label: 'Expiry date (optional)',
                      hintText: 'YYYY-MM-DD',
                      controller: _expiry,
                      enabled: !isBusy,
                    ),
                    const SizedBox(height: AppSpacing.s2),
                    PInput(
                      key: ManualAddScreen.lowThresholdFieldKey,
                      label: 'Low stock alert at (optional)',
                      hintText: '0.5',
                      controller: _lowThreshold,
                      enabled: !isBusy,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      useMonoFont: true,
                    ),
                  ],
                ),
              ),
            ),
            if (errorMessage != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.s3,
                  0,
                  AppSpacing.s3,
                  AppSpacing.s2,
                ),
                child: Text(
                  errorMessage,
                  style: AppTypography.label.copyWith(color: AppColors.danger),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.s3,
                0,
                AppSpacing.s3,
                AppSpacing.s3,
              ),
              child: PButton(
                key: ManualAddScreen.submitButtonKey,
                label: widget.isEditMode ? 'Save changes' : 'Add to pantry',
                isLoading: isBusy,
                expand: true,
                onPressed: _isValid ? _submit : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
