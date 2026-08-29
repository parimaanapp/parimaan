import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/state/freeform_parse_controller.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_recipe_repository.dart';

const AiRecipeDraft _rajmaDraft = AiRecipeDraft(title: 'Rajma Chawal');

ProviderContainer _container(FakeRecipeRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[recipeRepositoryProvider.overrideWithValue(repository)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('FreeformParseController', () {
    test('starts with a null draft and no error', () {
      final container = _container(FakeRecipeRepository());
      expect(
        container.read(freeformParseControllerProvider).value,
        isNull,
      );
    });

    test('parse returns the draft and leaves it in state on success', () async {
      final repository = FakeRecipeRepository()
        ..parseFreeformRecipeResult = _rajmaDraft;
      final container = _container(repository);

      final AiRecipeDraft? result = await container
          .read(freeformParseControllerProvider.notifier)
          .parse('Rajma Chawal: soak rajma overnight...');

      expect(result, _rajmaDraft);
      expect(repository.parseFreeformRecipeCalls, <String>[
        'Rajma Chawal: soak rajma overnight...',
      ]);
      expect(container.read(freeformParseControllerProvider).value, _rajmaDraft);
    });

    test('parse returns null and preserves the AppError subtype on failure', () async {
      final repository = FakeRecipeRepository()
        ..parseFreeformRecipeError = const ValidationError('text is too short to parse');
      final container = _container(repository);

      final AiRecipeDraft? result = await container
          .read(freeformParseControllerProvider.notifier)
          .parse('too short');

      expect(result, isNull);
      expect(
        container.read(freeformParseControllerProvider).error,
        isA<ValidationError>(),
      );
    });
  });
}
