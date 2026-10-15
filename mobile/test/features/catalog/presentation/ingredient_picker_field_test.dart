import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/catalog/data/catalog_repository.dart';
import 'package:mobile/features/catalog/domain/catalog_ingredient.dart';
import 'package:mobile/features/catalog/presentation/ingredient_picker_field.dart';
import 'package:mobile/shared/errors/app_error.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_catalog_repository.dart';

const Duration _debounce = Duration(milliseconds: 300);

class _Harness {
  _Harness(this.repository);

  final FakeCatalogRepository repository;
  final TextEditingController controller = TextEditingController();
  final List<CatalogIngredient> selected = <CatalogIngredient>[];
  final List<String> addedAsNew = <String>[];
}

Future<_Harness> _pump(
  WidgetTester tester, {
  FakeCatalogRepository? repository,
  bool enabled = true,
  Size size = const Size(400, 800),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final _Harness harness = _Harness(repository ?? FakeCatalogRepository());
  addTearDown(harness.controller.dispose);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        catalogRepositoryProvider.overrideWithValue(harness.repository),
      ],
      child: MaterialApp(
        theme: parimaanTheme(),
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: Scaffold(
          body: SingleChildScrollView(
            child: IngredientPickerField(
              controller: harness.controller,
              enabled: enabled,
              onSelected: harness.selected.add,
              onAddAsNew: harness.addedAsNew.add,
            ),
          ),
        ),
      ),
    ),
  );
  return harness;
}

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump(_debounce);
  await tester.pumpAndSettle();
}

void main() {
  group('IngredientPickerField', () {
    testWidgets('shows nothing and searches nothing before typing', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester);

      expect(find.byType(PickerResultRow), findsNothing);
      expect(find.byKey(IngredientPickerField.addAsNewKey), findsNothing);
      expect(h.repository.queries, isEmpty);
    });

    testWidgets('shows the canonical name and its category for a match', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      await _type(tester, 'toor');

      final Finder row = find.byKey(
        IngredientPickerField.resultKey(fixtureToorDal.id),
      );
      expect(row, findsOneWidget);
      expect(
        find.descendant(of: row, matching: find.text('Toor Dal')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row, matching: find.text('Dal')),
        findsOneWidget,
      );
    });

    testWidgets('hints which alias matched when the name did not', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      await _type(tester, 'arh');

      expect(
        find.byKey(IngredientPickerField.aliasHintKey(fixtureToorDal.id)),
        findsOneWidget,
      );
      expect(find.textContaining('arhar'), findsOneWidget);
    });

    testWidgets('shows no alias hint when the canonical name matched', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      await _type(tester, 'toor');

      expect(
        find.byKey(IngredientPickerField.aliasHintKey(fixtureToorDal.id)),
        findsNothing,
      );
    });

    testWidgets('debounces: rapid typing sends one search for the last text', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester);

      await tester.enterText(find.byType(TextField), 't');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.enterText(find.byType(TextField), 'to');
      await tester.pump(const Duration(milliseconds: 50));
      await tester.enterText(find.byType(TextField), 'tom');
      await tester.pump(_debounce);
      await tester.pumpAndSettle();

      expect(h.repository.queries, <String>['tom']);
    });

    testWidgets('picking a result fills the canonical name and reports it', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester);
      await _type(tester, 'arh');

      await tester.tap(
        find.byKey(IngredientPickerField.resultKey(fixtureToorDal.id)),
      );
      await tester.pumpAndSettle();

      expect(h.controller.text, 'Toor Dal');
      expect(h.selected, <CatalogIngredient>[fixtureToorDal]);
      // Panel closes and does not re-search the canonical name just set.
      expect(find.byType(PickerResultRow), findsNothing);
      expect(h.repository.queries, <String>['arh']);
    });

    testWidgets('offers "Add as new ingredient" for an unknown name', (
      WidgetTester tester,
    ) async {
      final _Harness h = await _pump(tester);
      await _type(tester, 'dragonfruit');

      expect(find.byType(PickerResultRow), findsNothing);
      expect(
        find.descendant(
          of: find.byKey(IngredientPickerField.addAsNewKey),
          matching: find.textContaining('dragonfruit'),
        ),
        findsOneWidget,
      );

      await tester.tap(find.byKey(IngredientPickerField.addAsNewKey));
      await tester.pumpAndSettle();

      expect(h.addedAsNew, <String>['dragonfruit']);
      expect(h.controller.text, 'dragonfruit');
      expect(find.byKey(IngredientPickerField.addAsNewKey), findsNothing);
    });

    testWidgets('keeps the fallback below real matches', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      await _type(tester, 'tom');

      expect(
        find.byKey(IngredientPickerField.resultKey(fixtureTomato.id)),
        findsOneWidget,
      );
      expect(find.byKey(IngredientPickerField.addAsNewKey), findsOneWidget);
    });

    testWidgets('hides the fallback when the text already is a catalog name', (
      WidgetTester tester,
    ) async {
      await _pump(tester);
      await _type(tester, 'Tomato');

      expect(find.byKey(IngredientPickerField.addAsNewKey), findsNothing);
    });

    testWidgets('a failed search still offers the free-text fallback', (
      WidgetTester tester,
    ) async {
      final FakeCatalogRepository repository = FakeCatalogRepository(
        error: const InternalError('boom'),
      );
      await _pump(tester, repository: repository);
      await _type(tester, 'paneer');

      expect(find.byKey(IngredientPickerField.addAsNewKey), findsOneWidget);
      expect(find.byKey(IngredientPickerField.searchErrorKey), findsOneWidget);
    });

    testWidgets('does not search while disabled', (WidgetTester tester) async {
      final _Harness h = await _pump(tester, enabled: false);

      h.controller.text = 'toor';
      await tester.pump(_debounce);
      await tester.pumpAndSettle();

      expect(h.repository.queries, isEmpty);
      expect(find.byType(PickerResultRow), findsNothing);
    });

    testWidgets('results wrap at 320pt and 2x text without overflow', (
      WidgetTester tester,
    ) async {
      await _pump(tester, size: const Size(320, 700), textScale: 2);
      await _type(tester, 'arh');

      expect(tester.takeException(), isNull);
      expect(
        find.byKey(IngredientPickerField.resultKey(fixtureToorDal.id)),
        findsOneWidget,
      );
      final Text name = tester.widget<Text>(
        find.descendant(
          of: find.byKey(IngredientPickerField.resultKey(fixtureToorDal.id)),
          matching: find.text('Toor Dal'),
        ),
      );
      expect(name.overflow, isNot(TextOverflow.ellipsis));
      expect(name.maxLines, isNull);
    });
  });
}
