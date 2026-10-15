import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/recipe.dart';

/// One card in the Recipes Library (E2E_MVP_PLAN.md §12.2.11) — title, role,
/// and total time, plus favorite/rotation indicators. Deliberately **no
/// image slot**: recipes have no photo field in W6 (§12.2.11), so this
/// mirrors `PantryRow`'s `PCard`-per-row shape rather than a media card.
class RecipeCard extends StatelessWidget {
  const RecipeCard({super.key, required this.recipe, this.onTap});

  final Recipe recipe;

  /// Opens the recipe (a later slice's Detail screen). `null` renders a
  /// non-interactive card.
  final VoidCallback? onTap;

  static const Key favoriteBadgeKey = Key('recipe-card-favorite');
  static const Key inRotationBadgeKey = Key('recipe-card-in-rotation');
  static const Key totalTimeKey = Key('recipe-card-total-time');

  @override
  Widget build(BuildContext context) {
    final int? totalTimeMin = recipe.totalTimeMin;

    return PCard(
      onTap: onTap,
      semanticLabel: '${recipe.title}, ${recipe.role.displayLabel}',
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  recipe.title,
                  style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
                ),
                const SizedBox(height: AppSpacing.s0),
                Text(
                  totalTimeMin == null
                      ? recipe.role.displayLabel
                      : '${recipe.role.displayLabel} · $totalTimeMin min',
                  key: totalTimeMin == null ? null : totalTimeKey,
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                ),
              ],
            ),
          ),
          if (recipe.isFavorite) ...<Widget>[
            const SizedBox(width: AppSpacing.s1),
            const PBadge(
              key: favoriteBadgeKey,
              label: 'Favorite',
              tone: PBadgeTone.accent,
              icon: Icons.favorite,
            ),
          ],
          if (recipe.inRotation) ...<Widget>[
            const SizedBox(width: AppSpacing.s1),
            const PBadge(
              key: inRotationBadgeKey,
              label: 'In rotation',
              tone: PBadgeTone.success,
            ),
          ],
        ],
      ),
    );
  }
}
