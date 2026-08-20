import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_card.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PCard renders at every elevation, plain and tappable',
    fileName: 'p_card',
    builder: () => GoldenTestGroup(
      columns: 2,
      scenarioConstraints: const BoxConstraints(maxWidth: 240),
      children: <Widget>[
        for (final PCardElevation elevation in PCardElevation.values)
          scenario(
            name: '${elevation.name} · ${_label(elevation)}',
            child: PCard(
              elevation: elevation,
              child: const Text('42 items · updated 2m ago'),
            ),
          ),
        scenario(
          name: 'e0 · tappable',
          child: PCard(
            onTap: () {},
            child: const Text('42 items · updated 2m ago'),
          ),
        ),
      ],
    ),
  );
}

String _label(PCardElevation elevation) {
  switch (elevation) {
    case PCardElevation.e0:
      return 'flat';
    case PCardElevation.e1:
      return 'resting';
    case PCardElevation.e2:
      return 'lifted';
  }
}
