import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/catalog/data/catalog_repository.dart';
import 'package:mobile/features/catalog/domain/catalog_ingredient.dart';
import 'package:mobile/features/catalog/presentation/ingredient_picker_field.dart';
import 'package:mobile/features/pantry/domain/category_units.dart';
import 'package:mobile/features/recipes/presentation/ingredient_row_editor.dart';
import 'package:mobile/shared/ui/components/components.dart';
import 'package:mobile/shared/ui/theme.dart';

import '../../../support/fake_catalog_repository.dart';

/// Holds the row state the screen normally owns, so the editor can be
/// exercised alone.
class _RowHost extends StatefulWidget {
  const _RowHost({
    required this.name,
    required this.quantity,
    required this.unit,
    this.initialCatalog,
  });

  final TextEditingController name;
  final TextEditingController quantity;
  final TextEditingController unit;
  final CatalogIngredient? initialCatalog;

  @override
  State<_RowHost> createState() => _RowHostState();
}

class _RowHostState extends State<_RowHost> {
  late CatalogIngredient? _catalog = widget.initialCatalog;

  @override
  Widget build(BuildContext context) => IngredientRowEditor(
    index: 0,
    nameController: widget.name,
    quantityController: widget.quantity,
    unitController: widget.unit,
    isStaple: false,
    onStapleChanged: (_) {},
    onRemove: () {},
    enabled: true,
    catalogIngredient: _catalog,
    onCatalogSelected: (CatalogIngredient ingredient) => setState(() {
      _catalog = ingredient;
      widget.unit.text = unitAfterSelection(ingredient, widget.unit.text);
    }),
    onAddAsNew: (_) => setState(() => _catalog = null),
  );
}

class _Controllers {
  final TextEditingController name = TextEditingController();
  final TextEditingController quantity = TextEditingController();
  final TextEditingController unit = TextEditingController();
}

Future<_Controllers> _pump(
  WidgetTester tester, {
  CatalogIngredient? initialCatalog,
  String name = '',
  String unit = '',
  Size size = const Size(400, 900),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final _Controllers c = _Controllers();
  c.name.text = name;
  c.unit.text = unit;
  addTearDown(() {
    c.name.dispose();
    c.quantity.dispose();
    c.unit.dispose();
  });

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        catalogRepositoryProvider.overrideWithValue(FakeCatalogRepository()),
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
            child: _RowHost(
              name: c.name,
              quantity: c.quantity,
              unit: c.unit,
              initialCatalog: initialCatalog,
            ),
          ),
        ),
      ),
    ),
  );
  return c;
}

Future<void> _typeName(WidgetTester tester, String text) async {
  await tester.enterText(
    find.byKey(IngredientRowEditor.nameFieldKey(0)),
    text,
  );
  await tester.pump(const Duration(milliseconds: 300));
  await tester.pumpAndSettle();
}

Set<String> _chipLabels(WidgetTester tester) => tester
    .widgetList<PChip>(
      find.byWidgetPredicate(
        (Widget w) =>
            w is PChip &&
            w.key is ValueKey<String> &&
            (w.key! as ValueKey<String>).value.startsWith(
              'ingredient-row-unit-0-',
            ),
      ),
    )
    .map((PChip c) => c.label)
    .toSet();

void main() {
  group('IngredientRowEditor — catalog picker', () {
    testWidgets('free text offers the full recipe unit list and a unit field', (
      WidgetTester tester,
    ) async {
      await _pump(tester);

      expect(_chipLabels(tester), recipeUnits.toSet());
      expect(
        find.byKey(IngredientRowEditor.unitFieldKey(0)),
        findsOneWidget,
      );
    });

    testWidgets('picking a catalog ingredient limits unit chips to its '
        'allowed units and fills the default', (WidgetTester tester) async {
      final _Controllers c = await _pump(tester);

      await _typeName(tester, 'arh');
      await tester.tap(
        find.byKey(IngredientPickerField.resultKey(fixtureToorDal.id)),
      );
      await tester.pumpAndSettle();

      expect(c.name.text, 'Toor Dal');
      expect(c.unit.text, 'g');
      expect(_chipLabels(tester), <String>{'g', 'kg', 'cup'});
      // No free-text unit entry once the catalog row bounds the choice.
      expect(find.byKey(IngredientRowEditor.unitFieldKey(0)), findsNothing);
    });

    testWidgets('tapping an allowed unit chip sets the unit', (
      WidgetTester tester,
    ) async {
      final _Controllers c = await _pump(
        tester,
        initialCatalog: fixtureToorDal,
        name: 'Toor Dal',
        unit: 'g',
      );

      await tester.tap(find.byKey(IngredientRowEditor.unitChipKey(0, 'kg')));
      await tester.pump();

      expect(c.unit.text, 'kg');
    });

    testWidgets('editing the name away from the pick returns to free text', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        initialCatalog: fixtureToorDal,
        name: 'Toor Dal',
        unit: 'g',
      );

      await tester.enterText(
        find.byKey(IngredientRowEditor.nameFieldKey(0)),
        'Toor Dal fresh',
      );
      await tester.pump();

      expect(_chipLabels(tester), recipeUnits.toSet());
      expect(
        find.byKey(IngredientRowEditor.unitFieldKey(0)),
        findsOneWidget,
      );
    });

    testWidgets('a unit outside the catalog list stays selectable', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        initialCatalog: fixtureToorDal,
        name: 'Toor Dal',
        unit: 'packet',
      );

      expect(_chipLabels(tester), <String>{'g', 'kg', 'cup', 'packet'});
    });

    testWidgets('quantity accepts at most two decimals', (
      WidgetTester tester,
    ) async {
      final _Controllers c = await _pump(tester);

      await tester.enterText(
        find.byKey(IngredientRowEditor.quantityFieldKey(0)),
        '1.255',
      );
      await tester.pump();
      expect(c.quantity.text, '1.25');

      await tester.enterText(
        find.byKey(IngredientRowEditor.quantityFieldKey(0)),
        '0.5',
      );
      await tester.pump();
      expect(c.quantity.text, '0.5');
    });

    testWidgets('unit chips wrap at 320pt and 2x text with nothing clipped', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        size: const Size(320, 900),
        textScale: 2,
        initialCatalog: const CatalogIngredient(
          id: 'oil',
          name: 'Sunflower Oil',
          category: 'oil',
          categoryLabel: 'Oil',
          allowedUnits: <String>['ml', 'l', 'tbsp', 'tsp', 'cup', 'bottle'],
          defaultUnit: 'ml',
        ),
        name: 'Sunflower Oil',
        unit: 'ml',
      );

      expect(tester.takeException(), isNull);
      for (final String unit in <String>[
        'ml',
        'l',
        'tbsp',
        'tsp',
        'cup',
        'bottle',
      ]) {
        final Finder chip = find.byKey(IngredientRowEditor.unitChipKey(0, unit));
        expect(chip, findsOneWidget);
        // Fully inside the 320pt viewport: wrapped onto the next line rather
        // than pushed off the edge or clipped.
        final Rect rect = tester.getRect(chip);
        expect(rect.left, greaterThanOrEqualTo(0));
        expect(rect.right, lessThanOrEqualTo(320));
        expect(find.text(unit), findsOneWidget);
      }
    });
  });
}
