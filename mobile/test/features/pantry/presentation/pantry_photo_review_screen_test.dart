import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/features/pantry/domain/pantry_unit.dart';
import 'package:mobile/features/pantry/presentation/pantry_photo_review_screen.dart';
import 'package:mobile/features/pantry/presentation/photo_analysis_failure_copy.dart';
import 'package:mobile/features/pantry/presentation/photo_dead_end.dart';
import 'package:mobile/features/pantry/presentation/photo_item_edit_sheet.dart';
import 'package:mobile/features/pantry/state/photo_review_session_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/storage/app_database.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_pantry_repository.dart';

PantryPhotoProposal _p(
  String name, {
  double? quantity = 1,
  String? unit = 'jar',
  String category = 'dal',
  ProposalConfidence confidence = ProposalConfidence.high,
}) => PantryPhotoProposal(
  name: name,
  quantity: quantity,
  unit: unit,
  category: category,
  confidence: confidence,
  warnings: const <String>[],
);

class _Harness {
  _Harness(this.container, this.repository);
  final ProviderContainer container;
  final FakePantryRepository repository;
  final List<int> done = <int>[];
  int cancels = 0;
  int anotherShelf = 0;
  int manual = 0;
}

Future<_Harness> _pump(
  WidgetTester tester,
  List<PantryPhotoProposal> proposals, {
  bool truncated = false,
  Set<String> pantryNames = const <String>{},
}) async {
  final FakePantryRepository repository = FakePantryRepository();
  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      pantryRepositoryProvider.overrideWithValue(repository),
      appDatabaseProvider.overrideWithValue(db),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(db.close);
  container
      .read(photoReviewSessionControllerProvider.notifier)
      .addAnalysis(
        PantryPhotoAnalysis(
          items: proposals,
          droppedCount: 0,
          truncated: truncated,
        ),
        pantryNames: pantryNames,
      );
  repository.bulkAddResult = <PantryItem>[];
  final _Harness h = _Harness(container, repository);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: PantryPhotoReviewScreen(
          householdId: 'household-1',
          onAddAnotherShelf: () => h.anotherShelf++,
          onAddManually: () => h.manual++,
          onCancel: () => h.cancels++,
          onDone: h.done.add,
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return h;
}

Finder _badge(String label) =>
    find.byWidgetPredicate((Widget w) => w is PBadge && w.label == label);

String _confirmLabel(WidgetTester tester) => tester
    .widget<PButton>(find.byKey(PantryPhotoReviewScreen.confirmKey))
    .label;

void main() {
  group('the review list', () {
    testWidgets(
      'leads with the count badge and the nothing-added-yet promise',
      (WidgetTester tester) async {
        await _pump(tester, <PantryPhotoProposal>[_p('Toor Dal'), _p('Ghee')]);

        expect(_badge('◆ 2 items proposed'), findsOneWidget);
        expect(find.text('Nothing is added until you say so.'), findsOneWidget);
      },
    );

    testWidgets('says "1 item" in the singular', (WidgetTester tester) async {
      await _pump(tester, <PantryPhotoProposal>[_p('Toor Dal')]);

      expect(_badge('◆ 1 item proposed'), findsOneWidget);
    });

    testWidgets('each row shows a text confidence tag, never colour alone', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal'),
        _p('Red Powder', confidence: ProposalConfidence.medium),
        _p('Mystery', confidence: ProposalConfidence.low),
      ]);

      expect(find.text('✓ ok'), findsOneWidget);
      expect(find.text('check'), findsOneWidget);
      expect(find.text('guess'), findsOneWidget);
    });

    testWidgets('shows the amount and category of each item', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal', quantity: 2, unit: 'packet'),
      ]);

      expect(find.text('2 packet · Dal'), findsOneWidget);
    });

    testWidgets(
      'low-confidence rows start unticked, so the confirm count excludes them',
      (WidgetTester tester) async {
        await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal'),
          _p('Mystery', confidence: ProposalConfidence.low),
        ]);

        expect(_confirmLabel(tester), 'Add 1 item');
      },
    );

    testWidgets('ticking a row updates the confirm count', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal'),
        _p('Mystery', confidence: ProposalConfidence.low),
      ]);
      final String id = h.container
          .read(photoReviewSessionControllerProvider)
          .items
          .last
          .id;

      await tester.tap(find.byKey(PantryPhotoReviewScreen.checkKey(id)));
      await tester.pumpAndSettle();

      expect(_confirmLabel(tester), 'Add 2 items');
    });

    testWidgets('a repeated name gets a warning note but is not blocked', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        <PantryPhotoProposal>[_p('Toor Dal')],
        pantryNames: <String>{'toor dal'},
      );

      expect(find.text('Already in your pantry'), findsOneWidget);
      expect(_confirmLabel(tester), 'Add 1 item');
    });

    testWidgets(
      'a ticked item with no amount is flagged and blocks confirm until fixed',
      (WidgetTester tester) async {
        await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal', quantity: null, unit: null),
        ]);

        expect(find.text('Needs an amount — tap to add'), findsOneWidget);
        expect(
          find.text('Add an amount to the items marked above.'),
          findsOneWidget,
        );
        final Finder confirm = find.byKey(PantryPhotoReviewScreen.confirmKey);
        await tester.tap(confirm);
        await tester.pumpAndSettle();
        expect(
          find.byKey(PantryPhotoReviewScreen.errorBannerKey),
          findsNothing,
        );
      },
    );

    testWidgets('notes when a very full shelf was cut short', (
      WidgetTester tester,
    ) async {
      await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal'),
      ], truncated: true);

      expect(
        find.byKey(PantryPhotoReviewScreen.truncatedNoteKey),
        findsOneWidget,
      );
    });
  });

  group('confirming', () {
    testWidgets(
      'adds exactly the ticked items, with their category, then clears the session and reports the count',
      (WidgetTester tester) async {
        final _Harness h = await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal', quantity: 2, unit: 'packet'),
          _p('Mystery', confidence: ProposalConfidence.low),
        ]);

        await tester.tap(find.byKey(PantryPhotoReviewScreen.confirmKey));
        await tester.pumpAndSettle();

        expect(h.repository.bulkAddCalls, hasLength(1));
        expect(h.repository.bulkAddCalls.single.householdId, 'household-1');
        expect(
          h.repository.bulkAddCalls.single.items.map((d) => d.name),
          <String>['Toor Dal'],
        );
        expect(h.repository.bulkAddCalls.single.items.single.category, 'dal');
        expect(h.done, <int>[1]);
        expect(
          h.container.read(photoReviewSessionControllerProvider).items,
          isEmpty,
        );
      },
    );

    testWidgets(
      'a server failure keeps the review, shows why, and does not report done',
      (WidgetTester tester) async {
        final _Harness h = await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal'),
        ]);
        h.repository.bulkAddError = const HouseholdFullError(
          'Your pantry is full.',
        );

        await tester.tap(find.byKey(PantryPhotoReviewScreen.confirmKey));
        await tester.pumpAndSettle();

        expect(
          find.byKey(PantryPhotoReviewScreen.errorBannerKey),
          findsOneWidget,
        );
        expect(find.text('Your pantry is full.'), findsOneWidget);
        expect(h.done, isEmpty);
        expect(
          h.container.read(photoReviewSessionControllerProvider).items,
          hasLength(1),
        );
        // Confirm is available again for a retry.
        expect(find.byKey(PantryPhotoReviewScreen.confirmKey), findsOneWidget);
      },
    );
  });

  group('leaving', () {
    testWidgets(
      'cancel asks before discarding, and "Keep reviewing" keeps everything',
      (WidgetTester tester) async {
        final _Harness h = await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal'),
        ]);

        await tester.tap(find.byKey(PantryPhotoReviewScreen.cancelKey));
        await tester.pumpAndSettle();
        expect(find.text('Discard this review?'), findsOneWidget);

        await tester.tap(find.byKey(PantryPhotoReviewScreen.keepReviewingKey));
        await tester.pumpAndSettle();

        expect(h.cancels, 0);
        expect(
          h.container.read(photoReviewSessionControllerProvider).items,
          hasLength(1),
        );
      },
    );

    testWidgets('discarding clears the session and calls onCancel', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal'),
      ]);

      await tester.tap(find.byKey(PantryPhotoReviewScreen.cancelKey));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(PantryPhotoReviewScreen.discardConfirmKey));
      await tester.pumpAndSettle();

      expect(h.cancels, 1);
      expect(
        h.container.read(photoReviewSessionControllerProvider).items,
        isEmpty,
      );
      expect(h.repository.bulkAddCalls, isEmpty);
    });

    testWidgets('"Add another shelf" hands control back and keeps the items', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal'),
      ]);

      await tester.tap(find.byKey(PantryPhotoReviewScreen.addAnotherShelfKey));
      await tester.pumpAndSettle();

      expect(h.anotherShelf, 1);
      expect(
        h.container.read(photoReviewSessionControllerProvider).items,
        hasLength(1),
      );
    });
  });

  group('editing a row', () {
    testWidgets(
      'tapping the row opens the edit sheet; saving updates the row',
      (WidgetTester tester) async {
        final _Harness h = await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal'),
        ]);
        final String id = h.container
            .read(photoReviewSessionControllerProvider)
            .items
            .single
            .id;

        await tester.tap(find.text('Toor Dal'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.descendant(
            of: find.byKey(PhotoItemEditSheet.nameFieldKey),
            matching: find.byType(TextField),
          ),
          'Moong Dal',
        );
        await tester.enterText(
          find.descendant(
            of: find.byKey(PhotoItemEditSheet.quantityFieldKey),
            matching: find.byType(TextField),
          ),
          '3',
        );
        await tester.tap(find.byKey(PhotoItemEditSheet.unitChipKey('packet')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(PhotoItemEditSheet.doneKey));
        await tester.pumpAndSettle();

        final PantryPhotoProposal edited = h.container
            .read(photoReviewSessionControllerProvider)
            .items
            .single
            .proposal;
        expect(edited.name, 'Moong Dal');
        expect(edited.quantity, 3);
        expect(edited.unit, 'packet');
        expect(find.byKey(PantryPhotoReviewScreen.rowKey(id)), findsOneWidget);
      },
    );

    testWidgets('the sheet\'s Remove drops the row', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester, <PantryPhotoProposal>[
        _p('Toor Dal'),
        _p('Ghee'),
      ]);

      await tester.tap(find.text('Toor Dal'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(PhotoItemEditSheet.removeKey));
      await tester.pumpAndSettle();

      expect(
        h.container
            .read(photoReviewSessionControllerProvider)
            .items
            .map((i) => i.proposal.name),
        <String>['Ghee'],
      );
    });

    testWidgets(
      'removing the last row lands on the empty state, not a blank list',
      (WidgetTester tester) async {
        final _Harness h = await _pump(tester, <PantryPhotoProposal>[
          _p('Toor Dal'),
        ]);

        await tester.tap(find.text('Toor Dal'));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(PhotoItemEditSheet.removeKey));
        await tester.pumpAndSettle();

        expect(find.byType(PhotoDeadEnd), findsOneWidget);
        await tester.tap(
          find.byKey(PhotoDeadEnd.actionKey(PhotoFailureAction.addManually)),
        );
        await tester.pumpAndSettle();
        expect(h.manual, 1);
      },
    );
  });

  group('photoProposalUnits', () {
    test('are all units the pantry accepts', () {
      expect(knownPantryUnits, containsAll(photoProposalUnits));
      expect(photoProposalUnits, isNot(contains('tsp')));
    });
  });
}
