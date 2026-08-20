import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_icon_button.dart';
import 'package:mobile/shared/ui/components/p_top_bar.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PTopBar renders with and without its optional slots',
    fileName: 'p_top_bar',
    builder: () => GoldenTestGroup(
      columns: 1,
      scenarioConstraints: const BoxConstraints(maxWidth: 320),
      children: <Widget>[
        scenario(
          name: 'title only',
          child: const PTopBar(title: 'Pantry'),
        ),
        scenario(
          name: 'title + subtitle',
          child: const PTopBar(
            title: 'Pantry',
            subtitle: '42 items · updated 2m ago',
          ),
        ),
        scenario(
          name: 'back + trailing + subtitle',
          child: PTopBar(
            title: 'Pantry',
            subtitle: '42 items · updated 2m ago',
            onBack: () {},
            backSemanticLabel: 'Back',
            trailing: PIconButton(
              icon: Icons.more_horiz,
              semanticLabel: 'More actions',
              onPressed: () {},
            ),
          ),
        ),
      ],
    ),
  );
}
