import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/proposed_field.dart';

void main() {
  group('ProposedField', () {
    test('.proposed is a proposal with hasProposal true when the value is non-null', () {
      const field = ProposedField<String>.proposed('Rajma Chawal');
      expect(field.isProposed, isTrue);
      expect(field.isUserModified, isFalse);
      expect(field.value, 'Rajma Chawal');
      expect(field.hasProposal, isTrue);
    });

    test('a null proposal renders as an ordinary empty field — hasProposal is false', () {
      const field = ProposedField<String>.proposed(null);
      expect(field.isProposed, isTrue);
      expect(field.hasProposal, isFalse);
    });

    test('accepting marks it confirmed', () {
      const proposed = ProposedField<String>.proposed('Rajma Chawal');
      final accepted = proposed.accept();
      expect(accepted.value, 'Rajma Chawal');
      expect(accepted.isProposed, isFalse);
      expect(accepted.isUserModified, isFalse);
      expect(accepted.hasProposal, isFalse);
    });

    test('editing marks it confirmed AND user-modified, with the new value', () {
      const proposed = ProposedField<String>.proposed('Rajma Chawal');
      final edited = proposed.edit('Chole Chawal');
      expect(edited.value, 'Chole Chawal');
      expect(edited.isProposed, isFalse);
      expect(edited.isUserModified, isTrue);
    });

    test('editing an already-confirmed field still marks it user-modified', () {
      const confirmed = ProposedField<String>.confirmed('Rajma Chawal');
      final edited = confirmed.edit('Chole Chawal');
      expect(edited.value, 'Chole Chawal');
      expect(edited.isUserModified, isTrue);
    });

    test('editing an empty field still marks it user-modified', () {
      const empty = ProposedField<String>.empty();
      final edited = empty.edit('Chole Chawal');
      expect(edited.value, 'Chole Chawal');
      expect(edited.isUserModified, isTrue);
    });

    test('rejecting clears it', () {
      const proposed = ProposedField<String>.proposed('Rajma Chawal');
      final rejected = proposed.reject();
      expect(rejected.value, isNull);
      expect(rejected.isProposed, isFalse);
      expect(rejected.isUserModified, isFalse);
    });

    test('.empty has no value and is neither proposed nor user-modified', () {
      const field = ProposedField<String>.empty();
      expect(field.value, isNull);
      expect(field.isProposed, isFalse);
      expect(field.isUserModified, isFalse);
      expect(field.hasProposal, isFalse);
    });

    test('.confirmed is not a proposal even with a non-null value', () {
      const field = ProposedField<String>.confirmed('Rajma Chawal');
      expect(field.hasProposal, isFalse);
      expect(field.isUserModified, isFalse);
    });

    test('withValue preserves proposed/user-modified status while swapping the value', () {
      const proposed = ProposedField<String>.proposed('a very long title');
      final truncated = proposed.withValue('a very long…');
      expect(truncated.value, 'a very long…');
      expect(truncated.isProposed, isTrue);
      expect(truncated.hasProposal, isTrue);

      final editedThenTruncated = proposed.edit('user typed this').withValue('user typed…');
      expect(editedThenTruncated.isUserModified, isTrue);
      expect(editedThenTruncated.value, 'user typed…');
    });

    test('equality and hashCode are value-based', () {
      expect(
        const ProposedField<String>.proposed('x'),
        const ProposedField<String>.proposed('x'),
      );
      expect(
        const ProposedField<String>.proposed('x').hashCode,
        const ProposedField<String>.proposed('x').hashCode,
      );
      expect(
        const ProposedField<String>.proposed('x'),
        isNot(const ProposedField<String>.confirmed('x')),
      );
      expect(
        const ProposedField<String>.proposed('x'),
        isNot(const ProposedField<String>.proposed('y')),
      );
    });

    test('a list-typed value compares by content, not by instance', () {
      expect(
        ProposedField<List<String>>.proposed(<String>['veg']),
        ProposedField<List<String>>.proposed(<String>['veg']),
      );
      expect(
        ProposedField<List<String>>.proposed(<String>['veg']).hashCode,
        ProposedField<List<String>>.proposed(<String>['veg']).hashCode,
      );
      expect(
        ProposedField<List<String>>.proposed(<String>['veg']),
        isNot(ProposedField<List<String>>.proposed(<String>['non-veg'])),
      );
    });
  });
}
