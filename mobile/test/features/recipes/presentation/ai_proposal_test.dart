import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/proposed_field.dart';
import 'package:mobile/features/recipes/presentation/ai_proposal.dart';

import '../../../support/component_harness.dart';

const _titleKey = Key('ai-proposal-test-content');

Widget _harness({
  required ProposedField<String> field,
  required ValueChanged<ProposedField<String>> onChanged,
  List<String> warnings = const <String>[],
  int? maxDisplayLength,
}) => AIProposal<String>(
  field: field,
  onChanged: onChanged,
  warnings: warnings,
  maxDisplayLength: maxDisplayLength,
  builder: (context, field, onEdit, onAccept, onReject) => Column(
    mainAxisSize: MainAxisSize.min,
    children: <Widget>[
      Text(field.value ?? '(empty)', key: _titleKey),
      TextButton(onPressed: onAccept, child: const Text('Accept')),
      TextButton(
        onPressed: () => onEdit('${field.value}-edited'),
        child: const Text('Edit'),
      ),
      TextButton(onPressed: onReject, child: const Text('Reject')),
    ],
  ),
);

void main() {
  group('AIProposal', () {
    testWidgets(
      'a field with a proposal renders visually/semantically distinct from a confirmed one',
      (WidgetTester tester) async {
        await withSemantics(tester, () async {
          await pumpComponent(
            tester,
            _harness(
              field: const ProposedField<String>.proposed('Rajma Chawal'),
              onChanged: (_) {},
            ),
          );

          expect(find.byKey(AIProposal.proposedBadgeKey), findsOneWidget);
          expect(
            find.bySemanticsLabel('AI-suggested, not yet confirmed'),
            findsOneWidget,
          );
        });
      },
    );

    testWidgets(
      'a user-confirmed field carries no proposal badge or distinguishing semantics label',
      (WidgetTester tester) async {
        await withSemantics(tester, () async {
          await pumpComponent(
            tester,
            _harness(
              field: const ProposedField<String>.confirmed('Rajma Chawal'),
              onChanged: (_) {},
            ),
          );

          expect(find.byKey(AIProposal.proposedBadgeKey), findsNothing);
          expect(
            find.bySemanticsLabel('AI-suggested, not yet confirmed'),
            findsNothing,
          );
        });
      },
    );

    testWidgets('accepting marks the field confirmed', (WidgetTester tester) async {
      ProposedField<String>? result;
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (field) => result = field,
        ),
      );

      await tester.tap(find.text('Accept'));
      await tester.pump();

      expect(result, isNotNull);
      expect(result!.value, 'Rajma Chawal');
      expect(result!.isProposed, isFalse);
      expect(result!.isUserModified, isFalse);
    });

    testWidgets('editing marks the field confirmed and user-modified', (
      WidgetTester tester,
    ) async {
      ProposedField<String>? result;
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (field) => result = field,
        ),
      );

      await tester.tap(find.text('Edit'));
      await tester.pump();

      expect(result, isNotNull);
      expect(result!.value, 'Rajma Chawal-edited');
      expect(result!.isUserModified, isTrue);
      expect(result!.isProposed, isFalse);
    });

    testWidgets('rejecting clears the field', (WidgetTester tester) async {
      ProposedField<String>? result;
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (field) => result = field,
        ),
      );

      await tester.tap(find.text('Reject'));
      await tester.pump();

      expect(result, isNotNull);
      expect(result!.value, isNull);
      expect(result!.isProposed, isFalse);
      expect(result!.isUserModified, isFalse);
    });

    testWidgets('a null proposal renders as an ordinary empty field, not a proposal', (
      WidgetTester tester,
    ) async {
      await withSemantics(tester, () async {
        await pumpComponent(
          tester,
          _harness(
            field: const ProposedField<String>.proposed(null),
            onChanged: (_) {},
          ),
        );

        expect(find.byKey(AIProposal.proposedBadgeKey), findsNothing);
        expect(
          find.bySemanticsLabel('AI-suggested, not yet confirmed'),
          findsNothing,
        );
        expect(find.text('(empty)'), findsOneWidget);
      });
    });

    testWidgets('warnings render as non-blocking notes, never as errors', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (_) {},
          warnings: const <String>['Could not determine cuisineTier2.'],
        ),
      );

      expect(find.byKey(AIProposal.warningsKey), findsOneWidget);
      expect(
        find.text('Could not determine cuisineTier2.'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.error), findsNothing);
      expect(find.byIcon(Icons.error_outline), findsNothing);
      expect(find.byIcon(Icons.info_outline), findsOneWidget);
    });

    testWidgets('no warnings list renders when there are no warnings', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (_) {},
        ),
      );

      expect(find.byKey(AIProposal.warningsKey), findsNothing);
    });

    testWidgets('an absurdly long string truncates before reaching the builder', (
      WidgetTester tester,
    ) async {
      final longValue = 'a' * 200;
      await pumpComponent(
        tester,
        _harness(
          field: ProposedField<String>.proposed(longValue),
          onChanged: (_) {},
          maxDisplayLength: 50,
        ),
      );

      final Text titleWidget = tester.widget<Text>(find.byKey(_titleKey));
      expect(titleWidget.data!.length, lessThan(longValue.length));
      expect(titleWidget.data, endsWith('…'));
    });

    testWidgets('maxDisplayLength never truncates a non-String field, e.g. an int', (
      WidgetTester tester,
    ) async {
      const intTitleKey = Key('ai-proposal-int-content');
      int? builderValue;
      await pumpComponent(
        tester,
        AIProposal<int>(
          field: const ProposedField<int>.proposed(42),
          onChanged: (_) {},
          maxDisplayLength: 1,
          builder: (context, field, onEdit, onAccept, onReject) {
            builderValue = field.value;
            return Text('${field.value}', key: intTitleKey);
          },
        ),
      );

      expect(builderValue, 42);
      expect(find.text('42'), findsOneWidget);
    });

    testWidgets('renders every warning without a duplicate-key collision', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (_) {},
          warnings: const <String>[
            'Could not determine cuisineTier2.',
            'Could not determine prepMin.',
          ],
        ),
      );

      expect(find.byKey(AIProposal.warningsKey), findsOneWidget);
      expect(find.text('Could not determine cuisineTier2.'), findsOneWidget);
      expect(find.text('Could not determine prepMin.'), findsOneWidget);
    });

    testWidgets('a string within maxDisplayLength is not truncated', (
      WidgetTester tester,
    ) async {
      await pumpComponent(
        tester,
        _harness(
          field: const ProposedField<String>.proposed('Rajma Chawal'),
          onChanged: (_) {},
          maxDisplayLength: 50,
        ),
      );

      expect(find.text('Rajma Chawal'), findsOneWidget);
    });
  });
}
