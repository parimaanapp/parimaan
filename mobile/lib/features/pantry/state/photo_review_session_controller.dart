import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/pantry_photo_analysis.dart';
import '../domain/photo_review_session.dart';

/// The accumulating review for "Add from a photo" (W20 S6, D7). One shelf per
/// photo means several photos per sitting, and their proposals gather in ONE
/// review rather than one confirm screen per photo.
///
/// Deliberately NOT auto-disposed: the session has to survive the trips
/// between the camera, the analyzing screen and the review. Whoever ends the
/// flow (confirm or cancel) calls [clear]; whoever starts it should too.
class PhotoReviewSessionController extends Notifier<PhotoReviewSession> {
  int _nextId = 0;
  Set<String> _pantryNames = const <String>{};

  @override
  PhotoReviewSession build() => PhotoReviewSession();

  static String _key(String name) => name.trim().toLowerCase();

  /// Appends [analysis]'s items. [pantryNames] is the household's current
  /// pantry, used only to flag duplicates (a note, never a block).
  void addAnalysis(PantryPhotoAnalysis analysis, {required Set<String> pantryNames}) {
    _pantryNames = pantryNames.map(_key).toSet();
    final List<PhotoReviewItem> added = <PhotoReviewItem>[
      for (final PantryPhotoProposal proposal in analysis.items)
        PhotoReviewItem(
          id: 'item-${_nextId++}',
          proposal: proposal,
          // D12: the fast path (accept the good ones) is also the safe one.
          selected: proposal.confidence != ProposalConfidence.low,
        ),
    ];
    state = PhotoReviewSession(items: _withDuplicateNotes(<PhotoReviewItem>[...state.items, ...added]), truncated: state.truncated || analysis.truncated);
  }

  /// Notes are recomputed across the whole list on every change, so renaming
  /// an item clears a note it no longer deserves and a removal can't leave a
  /// stale "also in an earlier photo" behind.
  List<PhotoReviewItem> _withDuplicateNotes(List<PhotoReviewItem> items) {
    final Set<String> seen = <String>{};
    return <PhotoReviewItem>[
      for (final PhotoReviewItem item in items)
        () {
          final String key = _key(item.proposal.name);
          final String? note = _pantryNames.contains(key)
              ? PhotoReviewItem.alreadyInPantryNote
              : (seen.contains(key) ? PhotoReviewItem.alsoInEarlierPhotoNote : null);
          seen.add(key);
          return note == null ? item.copyWith(clearDuplicateNote: true) : item.copyWith(duplicateNote: note);
        }(),
    ];
  }

  void _replace(String id, PhotoReviewItem Function(PhotoReviewItem) change) {
    if (!state.items.any((PhotoReviewItem i) => i.id == id)) {
      return;
    }
    state = PhotoReviewSession(
      items: _withDuplicateNotes(<PhotoReviewItem>[for (final PhotoReviewItem i in state.items) i.id == id ? change(i) : i]),
      truncated: state.truncated,
    );
  }

  void toggle(String id) => _replace(id, (PhotoReviewItem i) => i.copyWith(selected: !i.selected));

  void edit(String id, PantryPhotoProposal proposal) => _replace(id, (PhotoReviewItem i) => i.copyWith(proposal: proposal));

  void remove(String id) {
    if (!state.items.any((PhotoReviewItem i) => i.id == id)) {
      return;
    }
    state = PhotoReviewSession(
      items: _withDuplicateNotes(<PhotoReviewItem>[for (final PhotoReviewItem i in state.items) if (i.id != id) i]),
      truncated: state.truncated,
    );
  }

  void clear() {
    _pantryNames = const <String>{};
    state = PhotoReviewSession();
  }
}

final NotifierProvider<PhotoReviewSessionController, PhotoReviewSession> photoReviewSessionControllerProvider =
    NotifierProvider<PhotoReviewSessionController, PhotoReviewSession>(PhotoReviewSessionController.new);
