import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/ai_recipe_draft.dart';
import 'package:mobile/features/recipes/state/url_import_controller.dart';
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
  group('UrlImportController', () {
    test('starts with a null draft and no error', () {
      final container = _container(FakeRecipeRepository());
      expect(container.read(urlImportControllerProvider).value, isNull);
    });

    test('import returns the draft and leaves it in state on success', () async {
      final repository = FakeRecipeRepository()
        ..importRecipeFromUrlResult = _rajmaDraft;
      final container = _container(repository);

      final AiRecipeDraft? result = await container
          .read(urlImportControllerProvider.notifier)
          .import('https://example.com/rajma-chawal');

      expect(result, _rajmaDraft);
      expect(repository.importRecipeFromUrlCalls, <String>[
        'https://example.com/rajma-chawal',
      ]);
      expect(container.read(urlImportControllerProvider).value, _rajmaDraft);
    });

    test('import returns null and preserves the AppError subtype on failure', () async {
      final repository = FakeRecipeRepository()
        ..importRecipeFromUrlError = const UrlUnreadableError(
          "Couldn't read that page. Try pasting the recipe text instead.",
        );
      final container = _container(repository);

      final AiRecipeDraft? result = await container
          .read(urlImportControllerProvider.notifier)
          .import('https://example.com/unreadable');

      expect(result, isNull);
      expect(
        container.read(urlImportControllerProvider).error,
        isA<UrlUnreadableError>(),
      );
    });
  });
}
