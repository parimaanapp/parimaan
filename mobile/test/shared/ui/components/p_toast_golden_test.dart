import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_toast.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PToast renders every tone, with and without an action',
    fileName: 'p_toast',
    builder: () => GoldenTestGroup(
      columns: 2,
      scenarioConstraints: const BoxConstraints(maxWidth: 320),
      children: <Widget>[
        for (final PToastTone tone in PToastTone.values)
          scenario(
            name: tone.name,
            child: PToast(message: 'Added to pantry', tone: tone),
          ),
        scenario(
          name: 'with action',
          child: PToast(
            message: 'Removed from list',
            actionLabel: 'Undo',
            onAction: () {},
          ),
        ),
        scenario(
          name: 'with icon',
          child: const PToast(
            message: 'Saved',
            tone: PToastTone.success,
            icon: Icons.check,
          ),
        ),
      ],
    ),
  );
}
