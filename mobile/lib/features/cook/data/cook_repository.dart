import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/ferry_execute.dart';
import '../../../shared/graphql/operations/__generated__/cook_from_pantry.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/cook_from_pantry.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/cook_from_pantry.var.gql.dart';
import '../../../shared/errors/app_error.dart';
import '../domain/cook_suggestion.dart';
import '../domain/cook_vibe.dart';
import 'cook_mapper.dart';

/// W21 S4 — asks the server for up to 3 recipes the household can cook from
/// its pantry (`Mutation.cookFromPantry`, W21 S3).
abstract interface class CookRepository {
  /// Throws an [AppError] on failure (typed, see `shared/errors/app_error.dart`).
  Future<CookFromPantryResult> cookFromPantry({
    required String householdId,
    required CookVibe? vibe,
  });
}

class FerryCookRepository with FerryExecuteMixin implements CookRepository {
  const FerryCookRepository({required this.client});

  @override
  final Client client;

  @override
  Future<CookFromPantryResult> cookFromPantry({
    required String householdId,
    required CookVibe? vibe,
  }) async {
    final GCookFromPantryData data = await execute(
      GCookFromPantryReq(
        (GCookFromPantryReqBuilder b) => b
          ..vars = (GCookFromPantryVarsBuilder()
            ..householdId = householdId
            ..vibe = cookVibeToGraphQL(vibe)),
      ),
    );
    return cookFromPantryResultFromGraphQL(data.cookFromPantry);
  }
}

final Provider<CookRepository> cookRepositoryProvider =
    Provider<CookRepository>(
      (Ref ref) => FerryCookRepository(client: ref.watch(ferryClientProvider)),
    );
