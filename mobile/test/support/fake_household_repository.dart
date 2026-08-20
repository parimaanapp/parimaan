import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';

/// Hand-written [HouseholdRepository] double.
///
/// Hand-written rather than a `mocktail` mock because every test here needs to
/// control *when* the future completes (the Aurora cold-start loading state is
/// a first-class requirement of this slice), which a `thenAnswer` stub makes
/// awkward and this makes explicit.
class FakeHouseholdRepository implements HouseholdRepository {
  FakeHouseholdRepository({
    this.result,
    this.error,
    this.delay,
    this.settingsResult,
    this.settingsError,
  });

  /// Returned by [createHousehold] when [error] is null.
  Household? result;

  /// Thrown by [createHousehold] when set. Takes precedence over [result].
  Object? error;

  /// Returned by [updateHouseholdSettings] when [settingsError] is null.
  /// Defaults to whatever [result]'s settings are, so a test that only cares
  /// about *which* patch was sent never has to set it.
  HouseholdSettings? settingsResult;

  /// Thrown by [updateHouseholdSettings] when set.
  Object? settingsError;

  /// Every `(householdId, patch)` pair [updateHouseholdSettings] was called
  /// with, in order — this is what lets a controller test assert the
  /// "patch per step" contract rather than merely that *something* was sent.
  final List<({String householdId, HouseholdSettingsPatch patch})>
  settingsCalls = <({String householdId, HouseholdSettingsPatch patch})>[];

  /// Optional artificial latency, for asserting the loading state.
  Duration? delay;

  /// Every name [createHousehold] was called with, in order.
  final List<String> calls = <String>[];

  @override
  Future<Household> createHousehold(String name) async {
    calls.add(name);
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
    final Object? error = this.error;
    if (error != null) {
      throw error;
    }
    final Household? result = this.result;
    if (result == null) {
      throw StateError(
        'FakeHouseholdRepository needs either a `result` or an `error`.',
      );
    }
    return result;
  }

  @override
  Future<HouseholdSettings> updateHouseholdSettings(
    String householdId,
    HouseholdSettingsPatch patch,
  ) async {
    settingsCalls.add((householdId: householdId, patch: patch));
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
    final Object? error = settingsError;
    if (error != null) {
      throw error;
    }
    final HouseholdSettings? settings = settingsResult ?? result?.settings;
    if (settings == null) {
      throw StateError(
        'FakeHouseholdRepository needs a `settingsResult`, a `settingsError`, '
        'or a `result` whose settings can stand in.',
      );
    }
    return settings;
  }
}
