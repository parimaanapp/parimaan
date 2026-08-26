import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/presentation/pantry_row.dart';

import '../../../support/component_harness.dart';

PantryItem _item({
  String name = 'Toor Dal',
  double quantity = 2,
  String unit = 'kg',
  String? category = 'dal',
  bool isStaple = false,
  String? expiryDate,
  double? lowThreshold,
}) => PantryItem(
  id: 'item-1',
  householdId: 'household-1',
  name: name,
  quantity: quantity,
  unit: unit,
  category: category,
  isStaple: isStaple,
  expiryDate: expiryDate,
  lowThreshold: lowThreshold,
  addedBy: 'user-1',
  addedAt: DateTime.utc(2026, 8, 25),
  updatedAt: DateTime.utc(2026, 8, 25),
);

void main() {
  group('PantryRow', () {
    testWidgets('renders the name, quantity, and unit', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PantryRow(item: _item()));

      expect(find.text('Toor Dal'), findsOneWidget);
      expect(find.textContaining('2'), findsOneWidget);
      expect(find.textContaining('kg'), findsOneWidget);
    });

    testWidgets('shows a staple badge when isStaple is true', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PantryRow(item: _item(isStaple: true)));
      expect(find.byKey(PantryRow.stapleBadgeKey), findsOneWidget);
    });

    testWidgets('shows no staple badge when isStaple is false', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PantryRow(item: _item(isStaple: false)));
      expect(find.byKey(PantryRow.stapleBadgeKey), findsNothing);
    });

    testWidgets(
      'shows a running-low affordance when quantity is at or below lowThreshold',
      (WidgetTester tester) async {
        await pumpComponent(
          tester,
          PantryRow(item: _item(quantity: 1, lowThreshold: 2)),
        );
        expect(find.byKey(PantryRow.runningLowBadgeKey), findsOneWidget);
      },
    );

    testWidgets('shows no running-low affordance when there is no threshold', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PantryRow(item: _item()));
      expect(find.byKey(PantryRow.runningLowBadgeKey), findsNothing);
    });

    testWidgets('shows the expiry date when set', (WidgetTester tester) async {
      await pumpComponent(
        tester,
        PantryRow(item: _item(expiryDate: '2027-03-01')),
      );
      expect(find.textContaining('2027-03-01'), findsOneWidget);
    });

    testWidgets('shows no expiry text when expiryDate is null', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PantryRow(item: _item()));
      expect(find.byKey(PantryRow.expiryKey), findsNothing);
    });

    testWidgets('tapping the row calls onTap', (WidgetTester tester) async {
      bool tapped = false;
      await pumpComponent(
        tester,
        PantryRow(item: _item(), onTap: () => tapped = true),
      );
      await tester.tap(find.byType(PantryRow));
      expect(tapped, isTrue);
    });

    testWidgets('shows no delete button when onDelete is null', (
      WidgetTester tester,
    ) async {
      await pumpComponent(tester, PantryRow(item: _item()));
      expect(find.byKey(PantryRow.deleteButtonKey), findsNothing);
    });

    testWidgets('tapping delete calls onDelete', (WidgetTester tester) async {
      bool deleted = false;
      await pumpComponent(
        tester,
        PantryRow(item: _item(), onDelete: () => deleted = true),
      );
      await tester.tap(find.byKey(PantryRow.deleteButtonKey));
      expect(deleted, isTrue);
    });
  });
}
