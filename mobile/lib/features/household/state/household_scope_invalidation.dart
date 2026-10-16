import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../menu/state/current_menu_controller.dart';
import '../../menu/state/recipe_picker_controller.dart';
import '../../pantry/state/pantry_controller.dart';
import '../../recipes/state/recipe_detail_controller.dart';
import '../../recipes/state/recipe_library_controller.dart';
import '../../shopping_list/state/current_shopping_list_controller.dart';
import 'create_household_controller.dart';
import 'current_household_controller.dart';
import 'household_wizard_controller.dart';
import 'join_household_controller.dart';
import 'notification_preferences_controller.dart';

/// Drops every provider that holds data belonging to one household or to a
/// create/join session, so nothing from the previous household is shown after
/// the active household changes (or the user does).
///
/// Deliberately excludes the identity-level providers (`Query.me`, the caller's
/// user id, the pending deep-link code): those describe the user, not the
/// household, and sign-out invalidates them separately.
void invalidateHouseholdScopedState(Ref ref) {
  ref.invalidate(currentHouseholdControllerProvider);
  ref.invalidate(notificationPreferencesControllerProvider);
  ref.invalidate(pantryControllerProvider);
  ref.invalidate(recipeLibraryControllerProvider);
  ref.invalidate(recipeDetailControllerProvider);
  ref.invalidate(currentMenuControllerProvider);
  ref.invalidate(recipePickerControllerProvider);
  ref.invalidate(currentShoppingListControllerProvider);
  ref.invalidate(joinHouseholdControllerProvider);
  ref.invalidate(householdWizardControllerProvider);
  ref.invalidate(createHouseholdControllerProvider);
}
