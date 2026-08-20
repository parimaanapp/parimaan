import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/components/p_button.dart';

import '../../../support/golden_harness.dart';

void main() {
  goldenTest(
    'PButton renders every documented variant, size and state',
    fileName: 'p_button',
    // The loading scenarios hold a CircularProgressIndicator, whose animation
    // never settles — pump a fixed number of frames instead of settling.
    pumpBeforeTest: pumpNTimes(3),
    builder: () => GoldenTestGroup(
      columns: 3,
      scenarioConstraints: const BoxConstraints(maxWidth: 220),
      children: <Widget>[
        for (final PButtonVariant variant in PButtonVariant.values)
          scenario(
            name: variant.name,
            child: PButton(
              label: 'Plan the week',
              variant: variant,
              onPressed: () {},
            ),
          ),
        scenario(
          name: 'primary · disabled',
          child: const PButton(label: 'Plan the week', onPressed: null),
        ),
        scenario(
          name: 'primary · loading',
          child: PButton(
            label: 'Plan the week',
            loadingLabel: 'Planning…',
            isLoading: true,
            onPressed: () {},
          ),
        ),
        scenario(
          name: 'primary · with icon',
          child: PButton(label: 'Add item', icon: Icons.add, onPressed: () {}),
        ),
        scenario(
          name: 'primary · expanded',
          child: PButton(label: 'Auto-fill', expand: true, onPressed: () {}),
        ),
        scenario(
          name: 'small · secondary',
          child: PButton(
            label: 'Edit',
            variant: PButtonVariant.secondary,
            size: PButtonSize.small,
            onPressed: () {},
          ),
        ),
        scenario(
          name: 'affirmative · have it',
          child: PButton(
            label: '✓ Have it',
            variant: PButtonVariant.affirmative,
            onPressed: () {},
          ),
        ),
        scenario(
          name: 'destructive · clear week',
          child: PButton(
            label: 'Clear week',
            variant: PButtonVariant.destructive,
            onPressed: () {},
          ),
        ),
        scenario(
          name: 'icon-only 44x44',
          child: PButton.icon(
            icon: Icons.add,
            semanticLabel: 'Add item',
            onPressed: () {},
          ),
        ),
      ],
    ),
  );
}
