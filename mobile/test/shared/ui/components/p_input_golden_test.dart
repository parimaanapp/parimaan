import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_input.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PInput renders its states and its configurations',
    fileName: 'p_input',
    builder: () => GoldenTestGroup(
      columns: 2,
      scenarioConstraints: const BoxConstraints(maxWidth: 280),
      children: <Widget>[
        scenario(
          name: 'text · default',
          child: const PInput(label: 'Recipe name', hintText: 'e.g. Aloo Gobi'),
        ),
        scenario(
          name: 'text · with helper',
          child: const PInput(
            label: 'Recipe name',
            helperText: 'Shown to everyone in the household',
          ),
        ),
        scenario(
          name: 'text · error',
          child: PInput(
            label: 'Invite code',
            controller: TextEditingController(text: '0OIL'),
            useMonoFont: true,
            errorText: "Codes don't contain 0, O, I, or L.",
          ),
        ),
        scenario(
          name: 'text · disabled',
          child: PInput(
            label: 'Recipe name',
            enabled: false,
            controller: TextEditingController(text: 'Rajma'),
          ),
        ),
        scenario(
          name: 'search',
          child: const PInput(
            label: 'Find a recipe',
            hintText: 'Sabzi, dal, chicken…',
            prefixIcon: Icons.search,
          ),
        ),
        scenario(
          name: 'number + unit',
          child: PInput(
            label: 'Quantity',
            controller: TextEditingController(text: '250'),
            useMonoFont: true,
            textAlign: TextAlign.right,
            trailing: const Text('g'),
          ),
        ),
        scenario(
          name: 'textarea',
          child: PInput(
            label: 'Paste or type',
            minLines: 3,
            maxLines: 5,
            controller: TextEditingController(
              text: "Mom's rajma — soak overnight, pressure cook 4 whistles.",
            ),
          ),
        ),
      ],
    ),
  );
}
