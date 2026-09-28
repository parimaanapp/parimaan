import 'dart:async';
import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_photo_repository.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/domain/pantry_photo_analysis.dart';
import 'package:mobile/features/pantry/presentation/pantry_photo_analyzing_screen.dart';
import 'package:mobile/features/pantry/presentation/photo_analysis_failure_copy.dart';
import 'package:mobile/features/pantry/presentation/photo_dead_end.dart';
import 'package:mobile/features/pantry/state/pantry_photo_analysis_controller.dart';
import 'package:mobile/features/pantry/state/photo_review_session_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/storage/app_database.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_pantry_photo_repository.dart';
import '../../../support/fake_pantry_repository.dart';

final Uint8List _photo = Uint8List.fromList(<int>[0xff, 0xd8, 0xff, 1]);

PantryPhotoAnalysis _analysis(List<String> names) => PantryPhotoAnalysis(
  items: <PantryPhotoProposal>[
    for (final String n in names)
      PantryPhotoProposal(
        name: n,
        quantity: 1,
        unit: 'jar',
        category: 'dal',
        confidence: ProposalConfidence.high,
        warnings: const <String>[],
      ),
  ],
  droppedCount: 0,
  truncated: false,
);

class _Harness {
  _Harness(this.container, this.photos);
  final ProviderContainer container;
  final FakePantryPhotoRepository photos;
  int ready = 0;
  int retake = 0;
  int manual = 0;
  int cancel = 0;
}

Future<_Harness> _pump(
  WidgetTester tester, {
  Set<String> preload = const <String>{},
}) async {
  final FakePantryPhotoRepository photos = FakePantryPhotoRepository();
  final FakePantryRepository pantry = FakePantryRepository();
  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  pantry.result = <PantryItem>[];
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      pantryPhotoRepositoryProvider.overrideWithValue(photos),
      pantryRepositoryProvider.overrideWithValue(pantry),
      appDatabaseProvider.overrideWithValue(db),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(db.close);
  if (preload.isNotEmpty) {
    container
        .read(photoReviewSessionControllerProvider.notifier)
        .addAnalysis(
          _analysis(preload.toList()),
          pantryNames: const <String>{},
        );
  }
  final _Harness h = _Harness(container, photos);
  return h;
}

Future<void> _show(
  WidgetTester tester,
  _Harness h, {
  Duration slowHintAfter = const Duration(seconds: 10),
}) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: h.container,
      child: MaterialApp(
        theme: parimaanTheme(),
        home: Scaffold(
          body: PantryPhotoAnalyzingScreen(
            photo: _photo,
            householdId: 'household-1',
            slowHintAfter: slowHintAfter,
            onReviewReady: () => h.ready++,
            onRetake: () => h.retake++,
            onAddManually: () => h.manual++,
            onCancel: () => h.cancel++,
          ),
        ),
      ),
    ),
  );
}

/// The waiting state's progress bar animates forever, so `pumpAndSettle` never
/// returns; a few timed pumps are enough to let async work and rebuilds land.
Future<void> _frames(WidgetTester tester) async {
  for (int i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Unmounts the screen so its slow-hint timer is cancelled before the
/// framework's pending-timer check.
Future<void> _end(WidgetTester tester) => tester.pumpWidget(const SizedBox());

void main() {
  testWidgets(
    'sends the photo on arrival and shows it back with a plain-words phase',
    (WidgetTester tester) async {
      final _Harness h = await _pump(tester);
      final Completer<PantryPhotoAnalysis> gate = h.photos.hold();

      await _show(tester, h);
      await tester.pump();
      await tester.pump();

      expect(h.photos.calls, <Uint8List>[_photo]);
      expect(find.byKey(PantryPhotoAnalyzingScreen.photoKey), findsOneWidget);
      expect(find.text('Reading what’s on the shelf…'), findsOneWidget);
      expect(find.text('Nothing is added until you say so.'), findsOneWidget);
      await _end(tester);
      gate.complete(_analysis(<String>[]));
    },
  );

  testWidgets('a slow answer earns a reassurance line, not a spinner alone', (
    WidgetTester tester,
  ) async {
    final _Harness h = await _pump(tester);
    final Completer<PantryPhotoAnalysis> gate = h.photos.hold();

    await _show(tester, h, slowHintAfter: const Duration(seconds: 2));
    await tester.pump();
    expect(find.byKey(PantryPhotoAnalyzingScreen.slowHintKey), findsNothing);
    await tester.pump(const Duration(seconds: 3));

    expect(find.byKey(PantryPhotoAnalyzingScreen.slowHintKey), findsOneWidget);
    await _end(tester);
    gate.complete(_analysis(<String>[]));
  });

  testWidgets('proposals land in the review session and the flow moves on', (
    WidgetTester tester,
  ) async {
    final _Harness h = await _pump(tester);
    h.photos.succeedWith(_analysis(<String>['Toor Dal', 'Ghee']));

    await _show(tester, h);
    await _frames(tester);

    expect(h.ready, 1);
    expect(
      h.container
          .read(photoReviewSessionControllerProvider)
          .items
          .map((i) => i.proposal.name),
      <String>['Toor Dal', 'Ghee'],
    );
    await _end(tester);
  });

  testWidgets(
    'an empty answer with nothing gathered yet coaches, and does not open an empty review',
    (WidgetTester tester) async {
      final _Harness h = await _pump(tester);
      h.photos.succeedWith(_analysis(<String>[]));

      await _show(tester, h);
      await _frames(tester);

      expect(h.ready, 0);
      expect(find.text("Couldn't make out this shelf"), findsOneWidget);
      await tester.tap(
        find.byKey(PhotoDeadEnd.actionKey(PhotoFailureAction.retake)),
      );
      await _frames(tester);
      expect(h.retake, 1);
    },
  );

  testWidgets(
    'an empty answer when earlier shelves have items keeps going, with a quiet note',
    (WidgetTester tester) async {
      final _Harness h = await _pump(tester, preload: <String>{'Toor Dal'});
      h.photos.succeedWith(_analysis(<String>[]));

      await _show(tester, h);
      await tester.pump();
      await tester.pump();

      expect(h.ready, 1);
      expect(
        h.container.read(photoReviewSessionControllerProvider).items,
        hasLength(1),
      );
      await tester.pump(const Duration(seconds: 1));
      expect(
        find.textContaining("Couldn't make out that shelf"),
        findsOneWidget,
      );
      await _end(tester);
    },
  );

  testWidgets(
    'a retryable failure offers Try again first, and it re-sends the same photo',
    (WidgetTester tester) async {
      final _Harness h = await _pump(tester);
      h.photos.failWith(const AiTimeoutError('slow'));
      h.photos.succeedWith(_analysis(<String>['Toor Dal']));

      await _show(tester, h);
      await _frames(tester);
      expect(find.text('That took too long'), findsOneWidget);

      await tester.tap(
        find.byKey(PhotoDeadEnd.actionKey(PhotoFailureAction.retry)),
      );
      await _frames(tester);

      expect(h.photos.calls, hasLength(2));
      expect(h.ready, 1);
    },
  );

  testWidgets(
    'a failure a retry cannot fix does not offer Try again, and Add manually leaves the photo path',
    (WidgetTester tester) async {
      final _Harness h = await _pump(tester);
      h.photos.failWith(
        const RateLimitedError('You have used today’s photos.'),
      );

      await _show(tester, h);
      await _frames(tester);

      expect(
        find.byKey(PhotoDeadEnd.actionKey(PhotoFailureAction.retry)),
        findsNothing,
      );
      expect(find.text('You have used today’s photos.'), findsOneWidget);
      await tester.tap(
        find.byKey(PhotoDeadEnd.actionKey(PhotoFailureAction.addManually)),
      );
      await _frames(tester);
      expect(h.manual, 1);
    },
  );

  testWidgets('cancelling while waiting resets the analysis and reports it', (
    WidgetTester tester,
  ) async {
    final _Harness h = await _pump(tester);
    final Completer<PantryPhotoAnalysis> gate = h.photos.hold();

    await _show(tester, h);
    await tester.pump();
    await tester.tap(find.byKey(PantryPhotoAnalyzingScreen.cancelKey));
    await tester.pump();

    expect(h.cancel, 1);
    expect(
      h.container.read(pantryPhotoAnalysisControllerProvider),
      isA<PhotoAnalysisIdle>(),
    );
    await _end(tester);
    gate.complete(_analysis(<String>[]));
  });
}
