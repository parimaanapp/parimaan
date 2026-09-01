import 'package:ferry/ferry.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gql_exec/gql_exec.dart';
import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/cuisine_taxonomy.dart';
import 'package:mobile/features/household/domain/dietary_tag.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';
import 'package:mobile/features/household/domain/meal_structure.dart';
import 'package:mobile/features/household/domain/meal_type.dart';
import 'package:mobile/shared/errors/app_error.dart';

import '../../../support/fake_link.dart';
import '../../../support/household_fixtures.dart';

/// Same harness as `household_repository_test.dart` — a real Ferry [Client]
/// over a [FakeLink], so the generated `built_value` serializers and the
/// AppSync [ResponseParser] are genuinely exercised.
({FerryHouseholdRepository repository, FakeLink link}) _subject(
  Map<String, dynamic> Function(Request request) respond,
) {
  final FakeLink link = FakeLink(respond);
  final Client client = Client(link: link, cache: Cache());
  addTearDown(client.dispose);
  return (repository: FerryHouseholdRepository(client: client), link: link);
}

Map<String, dynamic> _ok(Request _) => <String, dynamic>{
  'data': updateHouseholdSettingsWireData(),
};

/// A failed AppSync response. `data` is `null` because `HouseholdSettings!` is
/// non-nullable, so error propagation nulls the whole root.
Map<String, dynamic> _errorBody(String errorType, String message) =>
    <String, dynamic>{
      'data': null,
      'errors': <dynamic>[
        <String, dynamic>{
          'path': <String>['updateHouseholdSettings'],
          'errorType': errorType,
          'message': message,
        },
      ],
    };

/// The `input` object as it actually left, cast for readability.
Map<String, dynamic> _sentInput(FakeLink link) =>
    (link.requests.single.variables['input'] as Map<String, dynamic>?) ??
    <String, dynamic>{};

void main() {
  group('FerryHouseholdRepository.updateHouseholdSettings — request', () {
    test('sends the UpdateHouseholdSettings operation with the household '
        'id', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
      );

      expect(subject.link.requests, hasLength(1));
      expect(
        subject.link.requests.single.operation.operationName,
        'UpdateHouseholdSettings',
      );
      expect(
        subject.link.requests.single.variables['householdId'],
        'household-1',
      );
    });

    test('a one-field patch sends exactly one input key — "patch per step" '
        'is observable on the wire', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.meals(<MealType>{
          MealType.breakfast,
          MealType.dinner,
        }),
      );

      expect(_sentInput(subject.link).keys, <String>['mealsEnabled']);
      expect(_sentInput(subject.link)['mealsEnabled'], <String>[
        'breakfast',
        'dinner',
      ]);
    });

    test('an absent field is omitted, never sent as an explicit null — the '
        'server rejects null', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
      );

      final Map<String, dynamic> input = _sentInput(subject.link);
      expect(input.containsKey('mealStructure'), isFalse);
      expect(input.containsKey('cuisineTier1'), isFalse);
      expect(input.containsKey('dietaryTags'), isFalse);
      expect(input.containsKey('allergens'), isFalse);
      expect(input.containsKey('skipIngredients'), isFalse);
      expect(input.values, isNot(contains(null)));
    });

    test('mealStructure goes over the wire as a JSON string, not an '
        'object', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.lunchStructure(LunchMealStructure.defaults),
      );

      expect(
        _sentInput(subject.link)['mealStructure'],
        '{"lunch":{"carb":2,"sabzi_dal":2,"accompaniment":1}}',
      );
      expect(_sentInput(subject.link)['mealStructure'], isA<String>());
    });

    test('cuisineTier2Weights goes over the wire as a JSON string with '
        '"normal", never "same"', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.cuisineWeights(<String, CuisineBias>{
          'punjabi': CuisineBias.normal,
        }),
      );

      expect(
        _sentInput(subject.link)['cuisineTier2Weights'],
        '{"punjabi":"normal"}',
      );
    });

    test('cuisine regions send their schema enum values', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.cuisineRegions(<CuisineRegion>{
          CuisineRegion.northIndian,
          CuisineRegion.indoChinese,
        }),
      );

      expect(_sentInput(subject.link)['cuisineTier1'], <String>[
        'north_indian',
        'indo_chinese',
      ]);
    });

    test('dietary tags send their schema enum values, including the two that '
        'differ from the chip copy', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.dietary(
          tags: <DietaryTag>{DietaryTag.eggetarian, DietaryTag.glutenFree},
          allergens: <String>['peanut'],
          skipIngredients: <String>['mustard oil'],
        ),
      );

      final Map<String, dynamic> input = _sentInput(subject.link);
      expect(input['dietaryTags'], <String>['eggetarian', 'gluten_free']);
      expect(input['allergens'], <String>['peanut']);
      expect(input['skipIngredients'], <String>['mustard oil']);
      expect(input.keys, hasLength(3));
    });

    test('an empty dietary selection is sent as an empty list, not '
        'omitted', () async {
      final subject = _subject(_ok);

      await subject.repository.updateHouseholdSettings(
        'household-1',
        HouseholdSettingsPatch.dietary(
          tags: const <DietaryTag>{},
          allergens: const <String>[],
          skipIngredients: const <String>[],
        ),
      );

      final Map<String, dynamic> input = _sentInput(subject.link);
      expect(input['dietaryTags'], isEmpty);
      expect(input.containsKey('dietaryTags'), isTrue);
    });
  });

  group('FerryHouseholdRepository.updateHouseholdSettings — success', () {
    test('maps the wire payload to the plain-Dart domain settings', () async {
      final subject = _subject(_ok);

      final Household household = await subject.repository
          .updateHouseholdSettings(
            'household-1',
            HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
          );

      final HouseholdSettings settings = household.settings;
      expect(settings.householdId, 'household-1');
      expect(settings.mealsEnabled, <String>['breakfast', 'lunch', 'dinner']);
      expect(settings.cuisineTier1, <String>['north_indian', 'south_indian']);
      expect(settings.dietaryTags, <String>['veg', 'eggetarian']);
      expect(settings.allergens, <String>['peanut']);
      expect(settings.skipIngredients, <String>['mustard oil']);
    });

    test('keeps both AWSJSON fields as raw JSON strings', () async {
      final subject = _subject(_ok);

      final Household household = await subject.repository
          .updateHouseholdSettings(
            'household-1',
            HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
          );

      expect(
        household.settings.mealStructureJson,
        '{"lunch":{"carb":2,"sabzi_dal":2,"accompaniment":1}}',
      );
      expect(
        household.settings.cuisineTier2WeightsJson,
        '{"punjabi":"more","marathi":"normal"}',
      );
    });

    test(
      'returns the whole settings row, not just the patched field',
      () async {
        final subject = _subject(_ok);

        final Household household = await subject.repository
            .updateHouseholdSettings(
              'household-1',
              HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
            );

        expect(household.settings, testHouseholdSettings);
      },
    );

    test(
      'returns the whole household, not just settings — the whole point of the widened return shape (W8 S10)',
      () async {
        final subject = _subject(_ok);

        final Household household = await subject.repository
            .updateHouseholdSettings(
              'household-1',
              HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
            );

        expect(household.id, 'household-1');
        expect(household.name, 'Kulkarni Kitchen');
        expect(household.members, isNotEmpty);
      },
    );

    test('an unrecognised server enum value degrades that entry rather than '
        'failing the response', () async {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': updateHouseholdSettingsWireData(
            mealsEnabled: <String>['lunch', 'brunch_from_a_newer_server'],
          ),
        },
      );

      final Household household = await subject.repository
          .updateHouseholdSettings(
            'household-1',
            HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
          );

      expect(household.settings.mealsEnabled, hasLength(2));
      expect(household.settings.mealsEnabled.first, 'lunch');
    });
  });

  group('FerryHouseholdRepository.updateHouseholdSettings — error mapping', () {
    final Map<String, Matcher> cases = <String, Matcher>{
      'UNAUTHORIZED': isA<UnauthorizedError>(),
      'FORBIDDEN': isA<ForbiddenError>(),
      'VALIDATION': isA<ValidationError>(),
      'CONFLICT': isA<ConflictError>(),
      'NOT_FOUND': isA<NotFoundError>(),
      'HOUSEHOLD_FULL': isA<HouseholdFullError>(),
      'RATE_LIMITED': isA<RateLimitedError>(),
      'INTERNAL': isA<InternalError>(),
    };

    for (final MapEntry<String, Matcher> entry in cases.entries) {
      test('${entry.key} surfaces as its AppError subtype', () {
        final subject = _subject(
          (Request _) => _errorBody(entry.key, 'copy for ${entry.key}'),
        );

        expect(
          subject.repository.updateHouseholdSettings(
            'household-1',
            HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
          ),
          throwsA(entry.value),
        );
      });
    }

    test('a non-member gets FORBIDDEN, carrying the server copy', () async {
      final subject = _subject(
        (Request _) =>
            _errorBody('FORBIDDEN', 'You are not a member of this household.'),
      );

      await expectLater(
        subject.repository.updateHouseholdSettings(
          'household-1',
          HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
        ),
        throwsA(
          isA<ForbiddenError>().having(
            (ForbiddenError e) => e.errorMessage,
            'errorMessage',
            'You are not a member of this household.',
          ),
        ),
      );
    });

    test('an unrecognised errorType falls back to InternalError', () {
      final subject = _subject(
        (Request _) => _errorBody('SOME_FUTURE_ERROR', 'from a newer server'),
      );

      expect(
        subject.repository.updateHouseholdSettings(
          'household-1',
          HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
        ),
        throwsA(isA<InternalError>()),
      );
    });

    test('a link/transport failure surfaces as InternalError', () {
      final subject = _subject((Request _) => throw const _TransportFailure());

      expect(
        subject.repository.updateHouseholdSettings(
          'household-1',
          HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
        ),
        throwsA(isA<AppError>()),
      );
    });

    test('an undeserializable payload throws an AppError, not a raw '
        'built_value failure', () {
      final subject = _subject(
        (Request _) => <String, dynamic>{
          'data': <String, dynamic>{'updateHouseholdSettings': null},
        },
      );

      expect(
        subject.repository.updateHouseholdSettings(
          'household-1',
          HouseholdSettingsPatch.meals(<MealType>{MealType.lunch}),
        ),
        throwsA(isA<AppError>()),
      );
    });
  });
}

class _TransportFailure implements Exception {
  const _TransportFailure();
}
