import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_button.dart';
import 'package:mobile/shared/ui/components/p_icon_button.dart';

import '../../../support/golden_harness.dart';
import '../../../support/tolerant_golden_comparator.dart';

void main() {
  // Contains drawn icon/spinner paths; CI anti-aliasing differs slightly from
  // macOS, so tolerate <= 0.5% diff for this file only.
  useTolerantGoldenComparator();

  goldenTest(
    'PIconButton renders every variant plus its disabled and loading states',
    fileName: 'p_icon_button',
    pumpBeforeTest: pumpNTimes(3),
    builder: () => GoldenTestGroup(
      columns: 4,
      scenarioConstraints: const BoxConstraints(maxWidth: 120),
      children: <Widget>[
        for (final PButtonVariant variant in PButtonVariant.values)
          scenario(
            name: variant.name,
            child: PIconButton(
              icon: Icons.add,
              semanticLabel: 'Add item',
              variant: variant,
              onPressed: () {},
            ),
          ),
        scenario(
          name: 'disabled',
          child: const PIconButton(
            icon: Icons.add,
            semanticLabel: 'Add item',
            onPressed: null,
          ),
        ),
        scenario(
          name: 'loading',
          child: PIconButton(
            icon: Icons.add,
            semanticLabel: 'Add item',
            isLoading: true,
            onPressed: () {},
          ),
        ),
      ],
    ),
  );
}
