import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/errors/app_error.dart';
import '../../../shared/graphql/__generated__/schema.schema.gql.dart';
import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/graphql_error_mapper.dart';
import '../../../shared/graphql/operations/__generated__/notification_preferences.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/notification_preferences.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/notification_preferences.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_notification_preferences.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_notification_preferences.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/update_notification_preferences.var.gql.dart';
import '../domain/notification_preferences.dart';
import 'notification_preferences_mapper.dart';

/// The app's notification-preferences surface, GraphQL-free.
///
/// **Error contract:** every method throws a subtype of `AppError` (via
/// `mapOperationFailure`) and nothing else — same contract as
/// `HouseholdRepository`.
abstract interface class NotificationPreferencesRepository {
  /// Reads the CALLER's own preferences for [householdId]. Always goes to
  /// the network, never ferry's cache — the same `FetchPolicy.NoCache`
  /// reasoning as `HouseholdRepository.fetchHousehold`: this screen wants
  /// the current server value on every entry, not a stale cached one.
  Future<NotificationPreferences> fetchPreferences(String householdId);

  /// Sets [field] to [value] for the CALLER's own row in [householdId] and
  /// returns the full updated preferences. One field per call, matching the
  /// screen's one-toggle-per-tap interaction — there is no batching need
  /// here the way the settings wizard's "patch per step" has one.
  Future<NotificationPreferences> updatePreference(
    String householdId,
    NotificationPreferenceField field,
    bool value,
  );
}

/// Ferry-backed [NotificationPreferencesRepository].
class FerryNotificationPreferencesRepository
    implements NotificationPreferencesRepository {
  const FerryNotificationPreferencesRepository({required this.client});

  final Client client;

  @override
  Future<NotificationPreferences> fetchPreferences(String householdId) async {
    final GNotificationPreferencesReq request = GNotificationPreferencesReq(
      (GNotificationPreferencesReqBuilder b) => b
        ..vars = (GNotificationPreferencesVarsBuilder()
          ..householdId = householdId)
        ..fetchPolicy = FetchPolicy.NoCache,
    );

    final GNotificationPreferencesData data = await _execute(request);
    return notificationPreferencesFromGraphQL(data.notificationPreferences);
  }

  @override
  Future<NotificationPreferences> updatePreference(
    String householdId,
    NotificationPreferenceField field,
    bool value,
  ) async {
    final GUpdateNotificationPreferencesReq request =
        GUpdateNotificationPreferencesReq(
          (GUpdateNotificationPreferencesReqBuilder b) =>
              b
                ..vars = (GUpdateNotificationPreferencesVarsBuilder()
                  ..householdId = householdId
                  ..input = _patchFor(field, value).toBuilder()),
        );

    final GUpdateNotificationPreferencesData data = await _execute(request);
    return notificationPreferencesFromGraphQL(
      data.updateNotificationPreferences,
    );
  }

  /// One field set, the other three deliberately absent — an absent field on
  /// `GNotificationPreferencesPatchInput` leaves that column unchanged
  /// server-side (W8 S8's patch convention). `built_value` builders leave an
  /// unset nullable field genuinely unset (not `null`), which is exactly the
  /// "absent from the request" shape the server distinguishes from an
  /// explicit `null`.
  GNotificationPreferencesPatchInput _patchFor(
    NotificationPreferenceField field,
    bool value,
  ) => GNotificationPreferencesPatchInput((
    GNotificationPreferencesPatchInputBuilder b,
  ) {
    switch (field) {
      case NotificationPreferenceField.listChanges:
        b.listChanges = value;
      case NotificationPreferenceField.mealReminder:
        b.mealReminder = value;
      case NotificationPreferenceField.expiry:
        b.expiry = value;
      case NotificationPreferenceField.activity:
        b.activity = value;
    }
  });

  /// See `HouseholdRepository._execute`'s identical doc for why "settled" is
  /// spelled out rather than using ferry's own `response.loading`.
  Future<TData> _execute<TData, TVars>(
    OperationRequest<TData, TVars> request,
  ) async {
    OperationResponse<TData, TVars>? settled;
    await for (final OperationResponse<TData, TVars> response in client.request(
      request,
    )) {
      if (response.data != null || response.hasErrors) {
        settled = response;
        break;
      }
    }

    // The stream ended without ever settling. Not expected, but returning
    // null or letting a `StateError` escape would both break the "throws
    // only AppError" contract.
    if (settled == null) {
      throw const InternalError(genericErrorMessage);
    }

    final TData? data = settled.data;
    if (settled.hasErrors || data == null) {
      throw mapOperationFailure(
        graphqlErrors: settled.graphqlErrors,
        linkException: settled.linkException,
      );
    }
    return data;
  }
}

/// Injection point for [NotificationPreferencesRepository] — same
/// composes-over-the-shared-client shape as `householdRepositoryProvider`.
final Provider<NotificationPreferencesRepository>
notificationPreferencesRepositoryProvider =
    Provider<NotificationPreferencesRepository>(
      (Ref ref) => FerryNotificationPreferencesRepository(
        client: ref.watch(ferryClientProvider),
      ),
    );
