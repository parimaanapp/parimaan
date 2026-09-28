import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/pantry_category.dart';
import '../domain/pantry_photo_analysis.dart';

/// Units a photo can honestly support — a subset of `knownPantryUnits` (a photo
/// cannot show a teaspoon). Mirrors `PHOTO_UNITS` in the API's proposal schema.
const List<String> photoProposalUnits = <String>[
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'packet',
  'bunch',
  'jar',
  'bottle',
];

/// The server's `MAX_NAME_LENGTH` for a pantry item name.
const int photoItemMaxNameLength = 120;

/// What the sheet closed with: an edited proposal, or a removal.
sealed class PhotoItemEditResult {
  const PhotoItemEditResult();
}

final class PhotoItemEdited extends PhotoItemEditResult {
  const PhotoItemEdited(this.proposal);
  final PantryPhotoProposal proposal;
}

final class PhotoItemRemoved extends PhotoItemEditResult {
  const PhotoItemRemoved();
}

/// Opens the edit sheet for one proposed item (Flow 9, W20 S6). Returns null
/// when dismissed without a decision.
Future<PhotoItemEditResult?> showPhotoItemEditSheet(
  BuildContext context,
  PantryPhotoProposal proposal,
) => showModalBottomSheet<PhotoItemEditResult>(
  context: context,
  isScrollControlled: true,
  backgroundColor: AppColors.paper,
  builder: (BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: PhotoItemEditSheet(proposal: proposal),
  ),
);

class PhotoItemEditSheet extends StatefulWidget {
  const PhotoItemEditSheet({super.key, required this.proposal});

  final PantryPhotoProposal proposal;

  static const Key nameFieldKey = Key('photo-edit-name');
  static const Key quantityFieldKey = Key('photo-edit-quantity');
  static const Key doneKey = Key('photo-edit-done');
  static const Key removeKey = Key('photo-edit-remove');
  static Key unitChipKey(String unit) => Key('photo-edit-unit-$unit');
  static Key categoryChipKey(String category) =>
      Key('photo-edit-category-$category');

  @override
  State<PhotoItemEditSheet> createState() => _PhotoItemEditSheetState();
}

class _PhotoItemEditSheetState extends State<PhotoItemEditSheet> {
  late final TextEditingController _name = TextEditingController(
    text: widget.proposal.name,
  );
  late final TextEditingController _quantity = TextEditingController(
    text: _format(widget.proposal.quantity),
  );
  late String? _unit = widget.proposal.unit;
  late String _category = widget.proposal.category;

  static String _format(double? q) => q == null
      ? ''
      : (q == q.roundToDouble() ? q.toInt().toString() : q.toString());

  @override
  void dispose() {
    _name.dispose();
    _quantity.dispose();
    super.dispose();
  }

  bool get _canSave => _name.text.trim().isNotEmpty;

  void _save() {
    final String name = _name.text.trim();
    final String rawQuantity = _quantity.text.trim();
    final double? parsed = double.tryParse(rawQuantity);
    final double? quantity = parsed != null && parsed > 0 ? parsed : null;
    final PantryPhotoProposal edited = widget.proposal.copyWith(
      name: name.length > photoItemMaxNameLength
          ? name.substring(0, photoItemMaxNameLength)
          : name,
      quantity: quantity,
      clearQuantity: quantity == null,
      unit: _unit,
      clearUnit: _unit == null,
      category: _category,
    );
    Navigator.of(context).pop(PhotoItemEdited(edited));
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(AppSpacing.s3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text('Edit item', style: AppTypography.displayM),
          const SizedBox(height: AppSpacing.s3),
          PInput(
            key: PhotoItemEditSheet.nameFieldKey,
            label: 'Name',
            controller: _name,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: AppSpacing.s2),
          PInput(
            key: PhotoItemEditSheet.quantityFieldKey,
            label: 'How many',
            controller: _quantity,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            useMonoFont: true,
            helperText: 'Count what you can see — a guess is fine, you can change it later.',
          ),
          const SizedBox(height: AppSpacing.s2),
          Text('Unit', style: AppTypography.label),
          const SizedBox(height: AppSpacing.s1),
          Wrap(
            spacing: AppSpacing.s1,
            runSpacing: AppSpacing.s1,
            children: <Widget>[
              for (final String unit in photoProposalUnits)
                PChip(
                  key: PhotoItemEditSheet.unitChipKey(unit),
                  label: unit,
                  selected: _unit == unit,
                  onTap: () => setState(() => _unit = unit),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.s2),
          Text('Category', style: AppTypography.label),
          const SizedBox(height: AppSpacing.s1),
          Wrap(
            spacing: AppSpacing.s1,
            runSpacing: AppSpacing.s1,
            children: <Widget>[
              for (final String category in knownPantryCategories)
                PChip(
                  key: PhotoItemEditSheet.categoryChipKey(category),
                  label: pantryCategoryLabel(category),
                  selected: _category == category,
                  onTap: () => setState(() => _category = category),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.s3),
          Row(
            children: <Widget>[
              Expanded(
                child: PButton(
                  key: PhotoItemEditSheet.removeKey,
                  label: 'Remove',
                  variant: PButtonVariant.destructive,
                  onPressed: () =>
                      Navigator.of(context).pop(const PhotoItemRemoved()),
                ),
              ),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                flex: 2,
                child: PButton(
                  key: PhotoItemEditSheet.doneKey,
                  label: 'Done',
                  onPressed: _canSave ? _save : null,
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
