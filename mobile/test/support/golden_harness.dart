// Shared scaffolding for the component golden tests.
//
// Convention for this repo: golden tests are **co-located** with the behaviour
// tests they belong to, named `*_golden_test.dart`, which puts the generated
// images in `test/shared/ui/components/goldens/ci/`. One component therefore
// has exactly one directory to look in, and adding a component never means
// editing a second tree.
import 'package:alchemist/alchemist.dart';
import 'package:flutter/material.dart';
import 'package:mobile/shared/ui/theme.dart';
import 'package:mobile/shared/ui/tokens.dart';

/// Wraps [child] on the app's paper background so a scenario is judged against
/// the surface it will really sit on, not against white.
Widget onPaper(Widget child) => ColoredBox(
  color: AppColors.paper,
  child: Padding(padding: const EdgeInsets.all(AppSpacing.s2), child: child),
);

/// A named scenario on the paper background.
GoldenTestScenario scenario({required String name, required Widget child}) =>
    GoldenTestScenario(name: name, child: onPaper(child));

/// The theme every golden renders under.
ThemeData goldenTheme() => parimaanTheme();
