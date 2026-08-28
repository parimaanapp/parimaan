import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft_ingredient.dart';
import 'package:mobile/features/recipes/domain/proposed_field.dart';
import 'package:mobile/features/recipes/domain/recipe_role.dart';
import 'package:mobile/features/recipes/state/recipe_draft_controller.dart';

const _draft = AiRecipeDraft(
  title: 'Rajma Chawal',
  description: 'A comforting kidney bean curry.',
  servings: 4,
  prepMin: 15,
  cookMin: 30,
  cuisineTier1: 'north_indian',
  cuisineTier2: 'punjabi',
  dietaryTags: <String>['veg'],
  role: RecipeRole.sabziDal,
  ingredients: <AiRecipeDraftIngredient>[
    AiRecipeDraftIngredient(raw: '1 cup rajma', name: 'Rajma', quantity: 1, unit: 'cup'),
  ],
  steps: <String>['Soak the rajma overnight.'],
  sourceUrl: 'https://example.com/rajma-chawal',
  warnings: <String>['Could not determine cuisineTier2.'],
);

void main() {
  group('AiRecipeDraftState.fromDraft', () {
    test('seeds every reviewable field as a proposal', () {
      final state = AiRecipeDraftState.fromDraft(_draft);

      expect(state.title, const ProposedField<String>.proposed('Rajma Chawal'));
      expect(state.servings, const ProposedField<int>.proposed(4));
      expect(state.role, const ProposedField<RecipeRole>.proposed(RecipeRole.sabziDal));
      expect(
        state.ingredients,
        ProposedField<List<AiRecipeDraftIngredient>>.proposed(_draft.ingredients),
      );
      expect(state.steps, ProposedField<List<String>>.proposed(_draft.steps));
    });

    test('passes sourceUrl and warnings through unchanged, not as proposals', () {
      final state = AiRecipeDraftState.fromDraft(_draft);
      expect(state.sourceUrl, 'https://example.com/rajma-chawal');
      expect(state.warnings, <String>['Could not determine cuisineTier2.']);
    });
  });

  group('AiRecipeDraftState.isRoleConfirmed', () {
    test('is false while the role is still a proposal', () {
      final state = AiRecipeDraftState.fromDraft(_draft);
      expect(state.isRoleConfirmed, isFalse);
    });

    test('is false when the role has no value at all', () {
      final state = AiRecipeDraftState.fromDraft(
        const AiRecipeDraft(role: null),
      );
      expect(state.isRoleConfirmed, isFalse);
    });

    test('is true once the role has been accepted (confirmed, non-null)', () {
      final state = AiRecipeDraftState.fromDraft(_draft);
      final confirmed = state.copyWith(role: state.role.accept());
      expect(confirmed.isRoleConfirmed, isTrue);
    });

    test('is true once the role has been user-modified', () {
      final state = AiRecipeDraftState.fromDraft(_draft);
      final edited = state.copyWith(
        role: state.role.edit(RecipeRole.breakfast),
      );
      expect(edited.isRoleConfirmed, isTrue);
    });
  });

  group('AiRecipeDraftController', () {
    test('build seeds state from the family argument draft', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.title.value, 'Rajma Chawal');
      expect(state.title.isProposed, isTrue);
    });

    test('updateTitle replaces only the title field', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(
        aiRecipeDraftControllerProvider(_draft).notifier,
      );
      notifier.updateTitle(const ProposedField<String>.userModified('Chole Chawal'));

      final state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.title.value, 'Chole Chawal');
      expect(state.title.isUserModified, isTrue);
      expect(state.servings.value, 4);
      expect(state.servings.isProposed, isTrue);
    });

    test('every remaining update* setter replaces only its own field', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(
        aiRecipeDraftControllerProvider(_draft).notifier,
      );

      notifier.updateDescription(const ProposedField<String>.userModified('New description'));
      var state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.description.value, 'New description');
      expect(state.servings.isProposed, isTrue);

      notifier.updateServings(const ProposedField<int>.userModified(6));
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.servings.value, 6);
      expect(state.prepMin.isProposed, isTrue);

      notifier.updatePrepMin(const ProposedField<int>.userModified(20));
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.prepMin.value, 20);
      expect(state.cookMin.isProposed, isTrue);

      notifier.updateCookMin(const ProposedField<int>.userModified(45));
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.cookMin.value, 45);
      expect(state.cuisineTier1.isProposed, isTrue);

      notifier.updateCuisineTier1(const ProposedField<String>.userModified('south_indian'));
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.cuisineTier1.value, 'south_indian');
      expect(state.cuisineTier2.isProposed, isTrue);

      notifier.updateCuisineTier2(const ProposedField<String>.userModified('kerala'));
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.cuisineTier2.value, 'kerala');
      expect(state.dietaryTags.isProposed, isTrue);

      notifier.updateDietaryTags(
        const ProposedField<List<String>>.userModified(<String>['vegan']),
      );
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.dietaryTags.value, <String>['vegan']);
      expect(state.ingredients.isProposed, isTrue);

      final newIngredients = <AiRecipeDraftIngredient>[
        const AiRecipeDraftIngredient(raw: '2 onions', name: 'Onion', quantity: 2, unit: null),
      ];
      notifier.updateIngredients(
        ProposedField<List<AiRecipeDraftIngredient>>.userModified(newIngredients),
      );
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.ingredients.value, newIngredients);
      expect(state.steps.isProposed, isTrue);

      notifier.updateSteps(
        const ProposedField<List<String>>.userModified(<String>['New step.']),
      );
      state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.steps.value, <String>['New step.']);

      expect(state.title.isProposed, isTrue);
      expect(state.title.value, 'Rajma Chawal');
    });

    test('updateRole replaces only the role field', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      final notifier = container.read(
        aiRecipeDraftControllerProvider(_draft).notifier,
      );
      notifier.updateRole(const ProposedField<RecipeRole>.confirmed(RecipeRole.breakfast));

      final state = container.read(aiRecipeDraftControllerProvider(_draft));
      expect(state.role.value, RecipeRole.breakfast);
      expect(state.isRoleConfirmed, isTrue);
    });

    test('two fetches of a structurally identical draft each start a fresh review', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);

      // Deliberately NOT `const` — a `const` literal with identical field
      // values canonicalizes to the same object as `_draft`, which would
      // defeat the very identity-based-family behaviour this test asserts.
      final secondFetch = AiRecipeDraft(
        title: 'Rajma Chawal',
        description: 'A comforting kidney bean curry.',
        servings: 4,
        prepMin: 15,
        cookMin: 30,
        cuisineTier1: 'north_indian',
        cuisineTier2: 'punjabi',
        dietaryTags: <String>['veg'],
        role: RecipeRole.sabziDal,
        ingredients: <AiRecipeDraftIngredient>[
          AiRecipeDraftIngredient(raw: '1 cup rajma', name: 'Rajma', quantity: 1, unit: 'cup'),
        ],
        steps: <String>['Soak the rajma overnight.'],
        sourceUrl: 'https://example.com/rajma-chawal',
        warnings: <String>['Could not determine cuisineTier2.'],
      );

      final firstNotifier = container.read(
        aiRecipeDraftControllerProvider(_draft).notifier,
      );
      firstNotifier.updateTitle(const ProposedField<String>.userModified('Edited Title'));

      final secondState = container.read(
        aiRecipeDraftControllerProvider(secondFetch),
      );
      expect(secondState.title.value, 'Rajma Chawal');
      expect(secondState.title.isProposed, isTrue);
      expect(secondState.title.isUserModified, isFalse);
    });
  });
}
