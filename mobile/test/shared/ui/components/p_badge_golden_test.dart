import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_badge.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PBadge renders every tone, plus its icon and count forms',
    fileName: 'p_badge',
    builder: () => GoldenTestGroup(
      columns: 4,
      scenarioConstraints: const BoxConstraints(maxWidth: 160),
      children: <Widget>[
        for (final PBadgeTone tone in PBadgeTone.values)
          scenario(
            name: tone.name,
            child: PBadge(label: tone.name, tone: tone),
          ),
        scenario(
          name: 'ai suggests',
          child: const PBadge(
            label: 'AI suggests',
            tone: PBadgeTone.warning,
            icon: Icons.circle,
          ),
        ),
        scenario(
          name: 'mixed case',
          child: const PBadge(label: 'In rotation', uppercase: false),
        ),
        scenario(
          name: 'count',
          child: const PBadge.count(count: 42, tone: PBadgeTone.accent),
        ),
      ],
    ),
  );
}
