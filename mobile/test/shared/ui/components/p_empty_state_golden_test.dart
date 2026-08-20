import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_button.dart';
import 'package:mobile/shared/ui/components/p_empty_state.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PEmptyState renders with the placeholder slot and with real artwork',
    fileName: 'p_empty_state',
    builder: () => GoldenTestGroup(
      columns: 2,
      scenarioConstraints: const BoxConstraints(maxWidth: 320),
      children: <Widget>[
        scenario(
          name: 'placeholder illustration',
          child: PEmptyState(
            headline: 'The week is a blank page',
            body:
                'Auto-fill from what your household usually rotates '
                'through, or pick meal by meal.',
            action: PButton(label: 'Auto-fill the week', onPressed: () {}),
          ),
        ),
        scenario(
          name: 'caller-supplied illustration',
          child: PEmptyState(
            illustration: const FlutterLogo(size: 96),
            headline: 'Nothing in the pantry yet',
            body:
                'Add what you already have so the list stops asking '
                'for it.',
            action: PButton(label: 'Add an item', onPressed: () {}),
          ),
        ),
      ],
    ),
  );
}
