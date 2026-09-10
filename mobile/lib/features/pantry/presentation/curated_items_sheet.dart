/// The category-scoped multi-select sheet + per-item quantity stepper for
/// W14 S5 (E2E_MVP_PLAN.md §20.2.5/§20.2.6, D5/D6).
///
/// ## Placement decision (the judgment call §20.3's S5 entry flags)
///
/// This sheet, and the category picker that raises it, are wired in from
/// `AddMethodScreen` — **not** from `ManualAddScreen` — for three reasons:
///
/// 1. `AddMethodScreen` is the screen whose whole job is "how do you want to
///    add this item"; a curated multi-select is a third *method* alongside
///    "Add manually" and "Add from a photo", not a modification to the
///    manual-entry form itself.
/// 2. `ManualAddScreen` is reused for **edit** mode (`initialItem` non-null,
///    §11.2.7) — a curated picker only ever makes sense for a brand-new
///    item, so hanging it off the create-only surface keeps it from ever
///    needing an "am I editing?" branch.
/// 3. Leaving `ManualAddScreen` untouched by this slice is the cheapest
///    possible guarantee that free-text add-by-typing stays byte-for-byte
///    "unchanged and co-equal" (D6) — there is no smaller diff that could
///    accidentally demote it.
///
/// `manual_add_screen.dart` is therefore **not** one of this slice's files.
///
/// ## What this file does not do
///
/// It never calls `bulkAddPantryItems`, `PantryController`, or
/// `PantryRepository` — S6 (E2E_MVP_PLAN.md §20.2.7) is the slice that
/// wires the sheet's [CuratedPantrySelection] list into one network call.
/// This file's job stops at handing that list back to its caller.
library;

import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/curated_pantry_items.dart';
import '../domain/curated_pantry_selection.dart';
import '../domain/pantry_category.dart';
import '../domain/pantry_unit.dart';

/// Whether [category] has at least one curated entry (D5's "incomplete is
/// allowed" property). A category with none — `produce`/`other` today, or
/// any free-typed category not in `curatedPantryItems` — must never reach
/// [CuratedItemsSheet.show]; the caller falls through to free-text entry
/// instead, so no empty-state dead end is ever rendered.
bool categoryHasCuratedEntries(String category) =>
    curatedPantryItems[category]?.isNotEmpty ?? false;

/// Raises the category picker, then the curated multi-select sheet for
/// whichever category is chosen — the whole D6 flow, as one call for
/// `AddMethodScreen` to await.
///
/// Returns the ticked-and-quantified items on a successful sheet commit, or
/// `null` if the user backed out of the category picker or the sheet
/// without confirming. If the chosen category has no curated entries at
/// all, [onFreeText] is invoked instead of ever opening the (empty) sheet —
/// D5's "no dead end" rule, satisfied by never showing the dead end rather
/// than by rendering and recovering from one.
Future<List<CuratedPantrySelection>?> showCuratedPantryFlow({
  required BuildContext context,
  required VoidCallback onFreeText,
}) async {
  final String? category = await showModalBottomSheet<String>(
    context: context,
    builder: (BuildContext context) => const _CategoryPickerSheet(),
  );
  if (category == null) {
    return null;
  }
  if (!categoryHasCuratedEntries(category)) {
    onFreeText();
    return null;
  }
  if (!context.mounted) {
    return null;
  }
  return CuratedItemsSheet.show(context, category);
}

class _CategoryPickerSheet extends StatelessWidget {
  const _CategoryPickerSheet();

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      key: CuratedItemsSheet.categoryPickerKey,
      padding: const EdgeInsets.all(AppSpacing.s3),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Choose a category',
            style: AppTypography.title.copyWith(color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.s2),
          Wrap(
            spacing: AppSpacing.s1,
            runSpacing: AppSpacing.s1,
            children: <Widget>[
              for (final String category in knownPantryCategories)
                PChip(
                  key: CuratedItemsSheet.categoryChipKey(category),
                  label: pantryCategoryLabel(category),
                  onTap: () => Navigator.of(context).pop(category),
                ),
            ],
          ),
        ],
      ),
    ),
  );
}

/// One item's own quantity/unit — kept `null`/`null` until the user actually
/// enters something, which is what keeps a freshly-ticked item empty rather
/// than inheriting anything (D5's third property, enforced here at the UI
/// layer too).
class _Selection {
  const _Selection({this.quantity, this.unit});

  final double? quantity;
  final String? unit;
}

/// The multi-select sheet for one category's curated items (D5/D6).
///
/// Lists `curatedPantryItems[category]` **in its declared order** — never
/// sorted, never alphabetised (§20.2.5's whole point). Ticking an item
/// raises a quantity + unit stepper for that item alone; the ten choices are
/// read straight from [knownPantryUnits], never re-listed here, so the two
/// can never silently drift apart (D6).
class CuratedItemsSheet extends StatefulWidget {
  const CuratedItemsSheet({
    super.key,
    required this.category,
    this.onSelectionChanged,
  });

  final String category;

  /// Fired with the current ticked-item list every time a tick, untick,
  /// quantity or unit changes — the seam this slice's own tests use to
  /// assert the sheet's selection state directly, since S6 (not this
  /// slice) is what wires a real commit path.
  final ValueChanged<List<CuratedPantrySelection>>? onSelectionChanged;

  static const Key categoryPickerKey = Key('curated-category-picker');
  static Key categoryChipKey(String category) =>
      Key('curated-category-chip-$category');

  static const Key sheetKey = Key('curated-items-sheet');
  static const Key confirmButtonKey = Key('curated-items-confirm');

  static Key itemRowKey(String name) => Key('curated-item-row-$name');
  static Key itemCheckboxKey(String name) => Key('curated-item-check-$name');
  static Key quantityFieldKey(String name) => Key('curated-item-qty-$name');
  static Key unitChipKey(String name, String unit) =>
      Key('curated-item-unit-$name-$unit');

  /// Raises this sheet as a modal bottom sheet for [category]. Callers must
  /// check [categoryHasCuratedEntries] first — this method does not fall
  /// back to free text itself; that fallback is a navigation decision that
  /// belongs to the caller ([showCuratedPantryFlow] makes it).
  static Future<List<CuratedPantrySelection>?> show(
    BuildContext context,
    String category,
  ) => showModalBottomSheet<List<CuratedPantrySelection>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (BuildContext context) => CuratedItemsSheet(category: category),
  );

  @override
  State<CuratedItemsSheet> createState() => _CuratedItemsSheetState();
}

class _CuratedItemsSheetState extends State<CuratedItemsSheet> {
  final Map<String, _Selection> _selections = <String, _Selection>{};
  late final Map<String, TextEditingController> _quantityControllers =
      <String, TextEditingController>{
        for (final String name in _items) name: TextEditingController(),
      };

  List<String> get _items => curatedPantryItems[widget.category] ?? const <String>[];

  @override
  void dispose() {
    for (final TextEditingController controller in _quantityControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  List<CuratedPantrySelection> get _committable => <CuratedPantrySelection>[
    for (final MapEntry<String, _Selection> entry in _selections.entries)
      if (entry.value.quantity != null &&
          entry.value.quantity! > 0 &&
          entry.value.unit != null)
        CuratedPantrySelection(
          name: entry.key,
          quantity: entry.value.quantity!,
          unit: entry.value.unit!,
        ),
  ];

  bool get _canConfirm => _selections.isNotEmpty && _committable.length == _selections.length;

  void _notify() => widget.onSelectionChanged?.call(_committable);

  void _toggle(String name, bool ticked) {
    setState(() {
      if (ticked) {
        _selections[name] = const _Selection();
      } else {
        // Unticking removes the item from what will be committed *and*
        // clears its stepper, so a later re-tick starts empty again rather
        // than reviving whatever the user typed before (D5's third
        // property, kept true across a tick/untick/tick cycle too).
        _selections.remove(name);
        _quantityControllers[name]?.clear();
      }
    });
    _notify();
  }

  void _setQuantity(String name, double? quantity) {
    final _Selection? current = _selections[name];
    if (current == null) {
      return;
    }
    setState(() {
      _selections[name] = _Selection(quantity: quantity, unit: current.unit);
    });
    _notify();
  }

  void _setUnit(String name, String unit) {
    final _Selection? current = _selections[name];
    if (current == null) {
      return;
    }
    setState(() {
      _selections[name] = _Selection(quantity: current.quantity, unit: unit);
    });
    _notify();
  }

  double? _parseQuantity(String text) {
    final String trimmed = text.trim();
    if (trimmed.isEmpty) {
      return null;
    }
    return double.tryParse(trimmed);
  }

  void _confirm() => Navigator.of(context).pop(_committable);

  @override
  Widget build(BuildContext context) {
    final List<String> items = _items;
    final int count = _selections.length;
    return Padding(
      key: CuratedItemsSheet.sheetKey,
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.65,
        minChildSize: 0.4,
        maxChildSize: 0.92,
        expand: false,
        builder: (BuildContext context, ScrollController scrollController) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.s3,
                AppSpacing.s3,
                AppSpacing.s3,
                AppSpacing.s1,
              ),
              child: Text(
                pantryCategoryLabel(widget.category),
                style: AppTypography.title.copyWith(color: AppColors.ink),
              ),
            ),
            Expanded(
              // A plain scrollable `Column`, not `ListView.builder` —
              // deliberately, so every row exists in the tree at once. No
              // curated category has "anywhere near 50 entries" (D7's own
              // words about the sibling `bulkAddPantryItems` cap apply
              // equally here), so lazy building buys nothing and costs the
              // declared-order guarantee its most direct test: a widget
              // test asserting row *position* needs every row actually
              // built, not just the ones a virtualised list happens to
              // have scrolled into its cache extent.
              child: SingleChildScrollView(
                controller: scrollController,
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final String name in items)
                      _CuratedItemRow(
                        name: name,
                        ticked: _selections[name] != null,
                        unit: _selections[name]?.unit,
                        quantityController: _quantityControllers[name]!,
                        onToggle: (bool ticked) => _toggle(name, ticked),
                        onQuantityChanged: (String text) =>
                            _setQuantity(name, _parseQuantity(text)),
                        onUnitChanged: (String unit) => _setUnit(name, unit),
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: PButton(
                key: CuratedItemsSheet.confirmButtonKey,
                label: count == 0 ? 'Add items' : 'Add $count item${count == 1 ? '' : 's'}',
                expand: true,
                onPressed: _canConfirm ? _confirm : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CuratedItemRow extends StatelessWidget {
  const _CuratedItemRow({
    required this.name,
    required this.ticked,
    required this.unit,
    required this.quantityController,
    required this.onToggle,
    required this.onQuantityChanged,
    required this.onUnitChanged,
  });

  final String name;
  final bool ticked;
  final String? unit;
  final TextEditingController quantityController;
  final ValueChanged<bool> onToggle;
  final ValueChanged<String> onQuantityChanged;
  final ValueChanged<String> onUnitChanged;

  @override
  Widget build(BuildContext context) => Padding(
    key: CuratedItemsSheet.itemRowKey(name),
    padding: const EdgeInsets.symmetric(vertical: AppSpacing.s1),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        InkWell(
          onTap: () => onToggle(!ticked),
          child: Row(
            children: <Widget>[
              Semantics(
                key: CuratedItemsSheet.itemCheckboxKey(name),
                checked: ticked,
                label: name,
                child: ExcludeSemantics(
                  child: Checkbox(
                    value: ticked,
                    onChanged: (bool? value) => onToggle(value ?? false),
                  ),
                ),
              ),
              Expanded(
                child: Text(name, style: AppTypography.body.copyWith(color: AppColors.ink)),
              ),
            ],
          ),
        ),
        if (ticked)
          Padding(
            padding: const EdgeInsets.only(
              left: AppSpacing.s5,
              right: AppSpacing.s1,
              bottom: AppSpacing.s2,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                PInput(
                  key: CuratedItemsSheet.quantityFieldKey(name),
                  label: 'Quantity',
                  hintText: '2',
                  controller: quantityController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  useMonoFont: true,
                  onChanged: onQuantityChanged,
                ),
                const SizedBox(height: AppSpacing.s1),
                Text(
                  'UNIT',
                  style: AppTypography.meta.copyWith(color: AppColors.inkMid),
                ),
                const SizedBox(height: AppSpacing.s0),
                Wrap(
                  spacing: AppSpacing.s1,
                  runSpacing: AppSpacing.s1,
                  children: <Widget>[
                    for (final String candidate in knownPantryUnits)
                      PChip(
                        key: CuratedItemsSheet.unitChipKey(name, candidate),
                        label: candidate,
                        selected: unit == candidate,
                        onTap: () => onUnitChanged(candidate),
                      ),
                  ],
                ),
              ],
            ),
          ),
      ],
    ),
  );
}
