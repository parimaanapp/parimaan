import 'package:flutter/foundation.dart';

import 'pantry_item_draft.dart';
import 'pantry_photo_analysis.dart';

/// The review screen's bulk-add ceiling — `maxBulkAddPantryItems` in
/// `pantry_form_controller.dart` and the server's own `MAX_BULK_PANTRY_ITEMS`.
/// Duplicated here as a domain constant so the session can say "too many" itself;
/// a test in `photo_review_session_controller_test.dart` exercises the boundary.
const int photoReviewBulkCap = 50;

/// One proposed item in the review, with what the USER has decided about it.
///
/// [proposal] is the model's answer plus any edits; [selected] is whether it
/// will be added. Immutable — every change is a new item, per this codebase's
/// no-mutation convention.
@immutable
class PhotoReviewItem {
  const PhotoReviewItem({required this.id, required this.proposal, required this.selected, this.duplicateNote});

  /// Shown under a row whose name matches something already in the pantry.
  static const String alreadyInPantryNote = 'Already in your pantry';

  /// Shown under a row that repeats an item from an earlier photo this session.
  static const String alsoInEarlierPhotoNote = 'Also in an earlier photo';

  final String id;
  final PantryPhotoProposal proposal;
  final bool selected;

  /// A warning, never a block and never a merge (W20 D7): silently merging two
  /// items would be a silent write.
  final String? duplicateNote;

  /// Whether this item has what `bulkAddPantryItems` requires — a positive
  /// amount and a unit. The model returns both for ~99% of items; the rest
  /// (an unrecognised unit, say) need the user, not a guess.
  bool get isComplete => (proposal.quantity ?? 0) > 0 && proposal.unit != null;

  PhotoReviewItem copyWith({PantryPhotoProposal? proposal, bool? selected, String? duplicateNote, bool clearDuplicateNote = false}) => PhotoReviewItem(
    id: id,
    proposal: proposal ?? this.proposal,
    selected: selected ?? this.selected,
    duplicateNote: clearDuplicateNote ? null : (duplicateNote ?? this.duplicateNote),
  );
}

/// Everything proposed across one or more photos, awaiting the user's confirm.
@immutable
class PhotoReviewSession {
  PhotoReviewSession({List<PhotoReviewItem> items = const <PhotoReviewItem>[], this.truncated = false}) : items = List<PhotoReviewItem>.unmodifiable(items);

  final List<PhotoReviewItem> items;

  /// A photo showed more than 40 items and the tail was cut.
  final bool truncated;

  int get selectedCount => items.where((PhotoReviewItem i) => i.selected).length;

  bool get overBulkCap => selectedCount > photoReviewBulkCap;

  /// Every ticked item has an amount and a unit.
  bool get allSelectedComplete => items.where((PhotoReviewItem i) => i.selected).every((PhotoReviewItem i) => i.isComplete);

  bool get canConfirm => selectedCount > 0 && allSelectedComplete && !overBulkCap;

  /// Exactly the ticked items, as pantry drafts. Category is kept — the
  /// curated picker's selections carry none, but a photo's items do, and the
  /// pantry list filters by it.
  List<PantryItemDraft> toDrafts() => <PantryItemDraft>[
    for (final PhotoReviewItem item in items)
      if (item.selected && item.isComplete)
        PantryItemDraft(name: item.proposal.name, quantity: item.proposal.quantity!, unit: item.proposal.unit!, category: item.proposal.category),
  ];
}
