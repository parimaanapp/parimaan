import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/state/current_household_controller.dart';
import 'package:mobile/features/household/state/membership_revocation_controller.dart';
import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/state/pantry_controller.dart';
import 'package:mobile/features/recipes/data/recipe_repository.dart';
import 'package:mobile/features/recipes/domain/recipe.dart';
import 'package:mobile/features/recipes/state/recipe_library_controller.dart';
import 'package:mobile/shared/storage/app_database.dart';

import '../../../support/fake_household_repository.dart';
import '../../../support/fake_pantry_repository.dart';
import '../../../support/fake_recipe_repository.dart';
import '../../../support/household_fixtures.dart';

ProviderContainer _container({
  required FakeHouseholdRepository householdRepository,
  FakePantryRepository? pantryRepository,
  FakeRecipeRepository? recipeRepository,
}) {
  final AppDatabase db = AppDatabase(NativeDatabase.memory());
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      householdRepositoryProvider.overrideWithValue(householdRepository),
      pantryRepositoryProvider.overrideWithValue(
        pantryRepository ?? FakePantryRepository(result: const <PantryItem>[]),
      ),
      recipeRepositoryProvider.overrideWithValue(
        recipeRepository ?? FakeRecipeRepository(result: const <Recipe>[]),
      ),
      appDatabaseProvider.overrideWithValue(db),
    ],
  );
  addTearDown(container.dispose);
  addTearDown(db.close);
  return container;
}

void main() {
  group('MembershipRevocationController — build', () {
    test('subscribes to watchMembershipRevoked for the household it is keyed on', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(householdRepository: repository);

      await container.read(
        membershipRevocationControllerProvider('household-1').future,
      );

      expect(repository.revokedWatchCalls, <String>['household-1']);
    });

    test('starts as false — nothing revoked yet', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(householdRepository: repository);

      final bool revoked = await container.read(
        membershipRevocationControllerProvider('household-1').future,
      );

      expect(revoked, isFalse);
    });

    test('disposing the container cancels the revocation subscription — no crash on a later push', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(householdRepository: repository);
      await container.read(
        membershipRevocationControllerProvider('household-1').future,
      );

      container.dispose();
      // Broadcast controllers accept `.add` with no listeners without
      // throwing — this only proves the controller-side subscription is
      // gone, not that `.add` itself would have failed.
      repository.revokedControllers['household-1']!.add(null);
      await Future<void>.delayed(Duration.zero);
    });
  });

  group('MembershipRevocationController — a live push (D7)', () {
    test('flips state to true on receipt', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(householdRepository: repository);
      await container.read(
        membershipRevocationControllerProvider('household-1').future,
      );

      repository.revokedControllers['household-1']!.add(null);
      await Future<void>.delayed(Duration.zero);

      expect(
        container.read(membershipRevocationControllerProvider('household-1')).valueOrNull,
        isTrue,
      );
    });

    test(
      'invalidates CurrentHouseholdController for the same household — its live subscription is torn down and resubscribed',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository(
          fetchResult: testHousehold,
        );
        final ProviderContainer container = _container(householdRepository: repository);
        await container.read(
          currentHouseholdControllerProvider('household-1').future,
        );
        await container.read(
          membershipRevocationControllerProvider('household-1').future,
        );
        expect(repository.watchCalls, <String>['household-1']);
        expect(repository.fetchCalls, <String>['household-1']);

        repository.revokedControllers['household-1']!.add(null);
        await Future<void>.delayed(Duration.zero);
        // `ref.invalidate` only marks the provider dirty — same as
        // `PantryFormController`'s own invalidation, whose own test
        // (`pantry_form_controller_test.dart`) re-reads to observe the
        // rebuild. Re-reading here is what actually reruns `build()`, which
        // is what cancels the OLD `StreamSubscription` (via its
        // `ref.onDispose`) and stands up a fresh one in its place — the
        // mechanism `_handleRevoked`'s own doc describes.
        await container.read(
          currentHouseholdControllerProvider('household-1').future,
        );

        expect(repository.watchCalls, <String>['household-1', 'household-1']);
        expect(repository.fetchCalls, <String>['household-1', 'household-1']);
      },
    );

    test(
      'invalidates PantryController and RecipeLibraryController for the same household',
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository();
        final FakePantryRepository pantryRepository = FakePantryRepository(
          result: const <PantryItem>[],
        );
        final FakeRecipeRepository recipeRepository = FakeRecipeRepository(
          result: const <Recipe>[],
        );
        final ProviderContainer container = _container(
          householdRepository: repository,
          pantryRepository: pantryRepository,
          recipeRepository: recipeRepository,
        );
        await container.read(pantryControllerProvider('household-1').future);
        await container.read(recipeLibraryControllerProvider('household-1').future);
        await container.read(
          membershipRevocationControllerProvider('household-1').future,
        );
        expect(pantryRepository.watchCalls, <String>['household-1']);
        expect(recipeRepository.watchCalls, <String>['household-1']);

        repository.revokedControllers['household-1']!.add(null);
        await Future<void>.delayed(Duration.zero);
        // Same "re-read to observe the rebuild" reasoning as the
        // household-controller test above.
        await container.read(pantryControllerProvider('household-1').future);
        await container.read(recipeLibraryControllerProvider('household-1').future);

        expect(pantryRepository.watchCalls, <String>['household-1', 'household-1']);
        expect(recipeRepository.watchCalls, <String>['household-1', 'household-1']);
      },
    );

    test(
      "a push for a DIFFERENT household never flips this household's state — cross-household isolation",
      () async {
        final FakeHouseholdRepository repository = FakeHouseholdRepository();
        final ProviderContainer container = _container(householdRepository: repository);
        await container.read(
          membershipRevocationControllerProvider('household-a').future,
        );
        await container.read(
          membershipRevocationControllerProvider('household-b').future,
        );

        repository.revokedControllers['household-b']!.add(null);
        await Future<void>.delayed(Duration.zero);

        expect(
          container.read(membershipRevocationControllerProvider('household-a')).valueOrNull,
          isFalse,
        );
        expect(
          container.read(membershipRevocationControllerProvider('household-b')).valueOrNull,
          isTrue,
        );
      },
    );

    test('an error on the revocation stream is swallowed — state stays false', () async {
      final FakeHouseholdRepository repository = FakeHouseholdRepository();
      final ProviderContainer container = _container(householdRepository: repository);
      await container.read(
        membershipRevocationControllerProvider('household-1').future,
      );

      repository.revokedControllers['household-1']!.addError(
        StateError('transport error'),
      );
      await Future<void>.delayed(Duration.zero);

      final AsyncValue<bool> state = container.read(
        membershipRevocationControllerProvider('household-1'),
      );
      expect(state.hasError, isFalse);
      expect(state.valueOrNull, isFalse);
    });
  });
}
