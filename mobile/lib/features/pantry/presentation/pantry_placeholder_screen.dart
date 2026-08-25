import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';

/// Stand-in for the Pantry tab, S5's replacement target.
///
/// This is the whole of what S4 (the nav shell) owns for this branch: an
/// empty, reachable scaffold. `PantryRow`, the search field, and the real
/// list are S5. When that slice lands, this file is replaced outright, the
/// same way `HomeScreen` replaced the router's own `_HomePlaceholderScreen`.
class PantryPlaceholderScreen extends StatelessWidget {
  const PantryPlaceholderScreen({super.key});

  @override
  Widget build(BuildContext context) => const Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(child: Center(child: Text('Pantry'))),
  );
}
