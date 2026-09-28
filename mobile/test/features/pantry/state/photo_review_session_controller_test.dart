import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/features/pantry/domain/photo_review_session.dart';
import 'package:mobile/features/pantry/state/photo_review_session_controller.dart';

PantryPhotoProposal _p(
  String name, {
  double? quantity = 1,
  String? unit = 'jar',
  String category = 'dal',
  ProposalConfidence confidence = ProposalConfidence.high,
}) => PantryPhotoProposal(name: name, quantity: quantity, unit: unit, category: category, confidence: confidence, warnings: const <String>[]);

PantryPhotoAnalysis _analysis(List<PantryPhotoProposal> items, {bool truncated = false}) =>
    PantryPhotoAnalysis(items: items, droppedCount: 0, truncated: truncated);

({ProviderContainer container, PhotoReviewSessionController controller}) _subject() {
  final ProviderContainer container = ProviderContainer();
  addTearDown(container.dispose);
  container.listen(photoReviewSessionControllerProvider, (_, _) {});
  return (container: container, controller: container.read(photoReviewSessionControllerProvider.notifier));
}

PhotoReviewSession _state(ProviderContainer c) => c.read(photoReviewSessionControllerProvider);

void main() {
  group('adding an analysis', () {
    test('appends its items; high and medium start ticked, low starts unticked (D12)', () {
      final s = _subject();
      s.controller.addAnalysis(
        _analysis(<PantryPhotoProposal>[
          _p('Toor Dal'),
          _p('Red Powder', confidence: ProposalConfidence.medium),
          _p('Mystery', confidence: ProposalConfidence.low),
        ]),
        pantryNames: const <String>{},
      );

      final List<PhotoReviewItem> items = _state(s.container).items;
      expect(items.map((PhotoReviewItem i) => i.proposal.name), <String>['Toor Dal', 'Red Powder', 'Mystery']);
      expect(items.map((PhotoReviewItem i) => i.selected), <bool>[true, true, false]);
    });

    test('a second photo\'s items are appended after the first\'s — the "add another shelf" loop keeps one review', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('Toor Dal')]), pantryNames: const <String>{});
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('Basmati Rice', category: 'grain')]), pantryNames: const <String>{});

      expect(_state(s.container).items.map((PhotoReviewItem i) => i.proposal.name), <String>['Toor Dal', 'Basmati Rice']);
    });

    test('every item gets a distinct id, across photos', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A'), _p('B')]), pantryNames: const <String>{});
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('C')]), pantryNames: const <String>{});

      final List<String> ids = _state(s.container).items.map((PhotoReviewItem i) => i.id).toList();
      expect(ids.toSet(), hasLength(3));
    });

    test('remembers that a photo hit the 40-item cap, across photos', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A')], truncated: true), pantryNames: const <String>{});
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('B')]), pantryNames: const <String>{});

      expect(_state(s.container).truncated, isTrue);
    });

    test('an empty analysis adds nothing and leaves earlier items alone', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A')]), pantryNames: const <String>{});
      s.controller.addAnalysis(_analysis(const <PantryPhotoProposal>[]), pantryNames: const <String>{});

      expect(_state(s.container).items, hasLength(1));
    });
  });

  group('duplicate warnings (D7) — a note, never a merge, never a block', () {
    test('flags an item already in the pantry, case-insensitively, and leaves it ticked', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('toor dal')]), pantryNames: const <String>{'Toor Dal'});

      final PhotoReviewItem item = _state(s.container).items.single;
      expect(item.duplicateNote, PhotoReviewItem.alreadyInPantryNote);
      expect(item.selected, isTrue);
    });

    test('flags an item that repeats one from an earlier photo in the same session', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('Toor Dal')]), pantryNames: const <String>{});
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('TOOR DAL')]), pantryNames: const <String>{});

      final List<PhotoReviewItem> items = _state(s.container).items;
      expect(items.first.duplicateNote, isNull);
      expect(items.last.duplicateNote, PhotoReviewItem.alsoInEarlierPhotoNote);
    });

    test('renaming an item clears a duplicate note it no longer deserves', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('Toor Dal')]), pantryNames: const <String>{'Toor Dal'});
      final PhotoReviewItem item = _state(s.container).items.single;

      s.controller.edit(item.id, item.proposal.copyWith(name: 'Masoor Dal'));

      expect(_state(s.container).items.single.duplicateNote, isNull);
    });

    test('an unrelated name is never flagged', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('Ghee')]), pantryNames: const <String>{'Toor Dal'});
      expect(_state(s.container).items.single.duplicateNote, isNull);
    });
  });

  group('editing the review', () {
    test('toggle flips one item and only that item', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A'), _p('B')]), pantryNames: const <String>{});
      final String idA = _state(s.container).items.first.id;

      s.controller.toggle(idA);

      expect(_state(s.container).items.map((PhotoReviewItem i) => i.selected), <bool>[false, true]);
    });

    test('edit replaces the proposal and keeps the id and tick state', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A')]), pantryNames: const <String>{});
      final PhotoReviewItem before = _state(s.container).items.single;

      s.controller.edit(before.id, before.proposal.copyWith(quantity: 3, unit: 'kg'));

      final PhotoReviewItem after = _state(s.container).items.single;
      expect(after.id, before.id);
      expect(after.proposal.quantity, 3);
      expect(after.proposal.unit, 'kg');
      expect(after.selected, before.selected);
    });

    test('remove drops the item', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A'), _p('B')]), pantryNames: const <String>{});
      s.controller.remove(_state(s.container).items.first.id);

      expect(_state(s.container).items.map((PhotoReviewItem i) => i.proposal.name), <String>['B']);
    });

    test('unknown ids are ignored, not thrown on — a stale tap must not crash the screen', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A')]), pantryNames: const <String>{});

      s.controller.toggle('nope');
      s.controller.edit('nope', _p('X'));
      s.controller.remove('nope');

      expect(_state(s.container).items, hasLength(1));
    });

    test('clear empties the session', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A')], truncated: true), pantryNames: const <String>{});
      s.controller.clear();

      expect(_state(s.container).items, isEmpty);
      expect(_state(s.container).truncated, isFalse);
    });
  });

  group('what can be confirmed', () {
    test('selectedCount counts ticked items only', () {
      final s = _subject();
      s.controller.addAnalysis(
        _analysis(<PantryPhotoProposal>[_p('A'), _p('B', confidence: ProposalConfidence.low)]),
        pantryNames: const <String>{},
      );
      expect(_state(s.container).selectedCount, 1);
    });

    test('a ticked item with no amount blocks confirming until it is filled in — a silent default would be a silent write', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A', quantity: null, unit: null)]), pantryNames: const <String>{});

      expect(_state(s.container).canConfirm, isFalse);
      expect(_state(s.container).items.single.isComplete, isFalse);

      final PhotoReviewItem item = _state(s.container).items.single;
      s.controller.edit(item.id, item.proposal.copyWith(quantity: 2, unit: 'packet'));
      expect(_state(s.container).canConfirm, isTrue);
    });

    test('an incomplete item that is UNticked does not block confirming the rest', () {
      final s = _subject();
      s.controller.addAnalysis(
        _analysis(<PantryPhotoProposal>[_p('Good'), _p('Vague', quantity: null, unit: null, confidence: ProposalConfidence.low)]),
        pantryNames: const <String>{},
      );
      expect(_state(s.container).canConfirm, isTrue);
    });

    test('nothing ticked cannot be confirmed', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(<PantryPhotoProposal>[_p('A')]), pantryNames: const <String>{});
      s.controller.toggle(_state(s.container).items.single.id);
      expect(_state(s.container).canConfirm, isFalse);
    });

    test('more than the 50-item bulk cap cannot be confirmed in one go', () {
      final s = _subject();
      s.controller.addAnalysis(_analysis(List<PantryPhotoProposal>.generate(40, (int i) => _p('A$i'))), pantryNames: const <String>{});
      s.controller.addAnalysis(_analysis(List<PantryPhotoProposal>.generate(20, (int i) => _p('B$i'))), pantryNames: const <String>{});

      expect(_state(s.container).selectedCount, 60);
      expect(_state(s.container).canConfirm, isFalse);
      expect(_state(s.container).overBulkCap, isTrue);
    });

    test('toDrafts turns exactly the ticked, complete items into pantry drafts — category kept', () {
      final s = _subject();
      s.controller.addAnalysis(
        _analysis(<PantryPhotoProposal>[
          _p('Toor Dal', quantity: 2, unit: 'jar', category: 'dal'),
          _p('Skipped', confidence: ProposalConfidence.low),
        ]),
        pantryNames: const <String>{},
      );

      final drafts = _state(s.container).toDrafts();

      expect(drafts, hasLength(1));
      expect(drafts.single.name, 'Toor Dal');
      expect(drafts.single.quantity, 2);
      expect(drafts.single.unit, 'jar');
      expect(drafts.single.category, 'dal');
    });
  });
}
