import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/pantry/data/pantry_mapper.dart';
import 'package:mobile/shared/graphql/__generated__/schema.schema.gql.dart';
import 'package:mobile/shared/graphql/operations/__generated__/pantry_item_fields.data.gql.dart';

void main() {
  group('pantryItemFromGraphQL', () {
    test('maps every field through', () {
      final GPantryItemFieldsData data = GPantryItemFieldsData(
        (GPantryItemFieldsDataBuilder b) => b
          ..id = 'item-1'
          ..householdId = 'household-1'
          ..name = 'Toor Dal'
          ..quantity = 2
          ..unit = 'kg'
          ..category = 'dal'
          ..isStaple = true
          ..expiryDate = GAWSDate('2027-03-01').toBuilder()
          ..lowThreshold = 0.5
          ..addedBy = 'user-1'
          ..addedAt = DateTime.utc(2026, 8, 25, 10)
          ..updatedAt = DateTime.utc(2026, 8, 25, 11),
      );

      final result = pantryItemFromGraphQL(data);

      expect(result.id, 'item-1');
      expect(result.householdId, 'household-1');
      expect(result.name, 'Toor Dal');
      expect(result.quantity, 2);
      expect(result.unit, 'kg');
      expect(result.category, 'dal');
      expect(result.isStaple, isTrue);
      expect(result.expiryDate, '2027-03-01');
      expect(result.lowThreshold, 0.5);
      expect(result.addedBy, 'user-1');
      expect(result.addedAt, DateTime.utc(2026, 8, 25, 10));
      expect(result.updatedAt, DateTime.utc(2026, 8, 25, 11));
    });

    test('maps a null category, expiryDate, and lowThreshold through as null', () {
      final GPantryItemFieldsData data = GPantryItemFieldsData(
        (GPantryItemFieldsDataBuilder b) => b
          ..id = 'item-1'
          ..householdId = 'household-1'
          ..name = 'Rice'
          ..quantity = 1
          ..unit = 'kg'
          ..isStaple = false
          ..addedBy = 'user-1'
          ..addedAt = DateTime.utc(2026, 8, 25, 10)
          ..updatedAt = DateTime.utc(2026, 8, 25, 11),
      );

      final result = pantryItemFromGraphQL(data);

      expect(result.category, isNull);
      expect(result.expiryDate, isNull);
      expect(result.lowThreshold, isNull);
    });
  });
}
