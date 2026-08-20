import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_chip.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PChip renders both variants, every tone and its on/off state',
    fileName: 'p_chip',
    builder: () => GoldenTestGroup(
      columns: 4,
      scenarioConstraints: const BoxConstraints(maxWidth: 160),
      children: <Widget>[
        scenario(
          name: 'filter · off',
          child: PChip(label: 'Carb', onTap: () {}),
        ),
        scenario(
          name: 'filter · on',
          child: PChip(label: 'All roles', selected: true, onTap: () {}),
        ),
        scenario(
          name: 'filter · static',
          child: const PChip(label: 'Sabzi · Dal'),
        ),
        scenario(
          name: 'filter · removable',
          child: PChip(
            label: 'Punjabi',
            selected: true,
            onRemove: () {},
            removeSemanticLabel: 'Remove Punjabi',
          ),
        ),
        for (final PChipTone tone in PChipTone.values)
          scenario(
            name: 'tag · ${tone.name}',
            child: PChip(
              label: tone.name,
              variant: PChipVariant.tag,
              tone: tone,
            ),
          ),
      ],
    ),
  );
}
