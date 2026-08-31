import 'dart:async';

import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';
import 'package:mobile/features/household/domain/household_settings_patch.dart';

/// Hand-written [HouseholdRepository] double.
///
/// Hand-written rather than a `mocktail` mock because every test here needs to
/// control *when* the future completes (the Aurora cold-start loading state is
/// a first-class requirement of this slice), which a `thenAnswer` stub makes
/// awkward and this makes explicit.
///
/// ## Shape
///
/// One `xResult` / `xError` pair and one call log per method. Verbose, but
/// each field says exactly which operation it configures — a single shared
/// `result`/`error` pair across seven methods would make a test that stubs
/// `joinHousehold` silently also stub `fetchHousehold`, and the two want
/// opposite outcomes constantly (join succeeds, the refetch afterwards
/// fails, and so on).
///
/// `error` takes precedence over `result` everywhere, and [delay] applies to
/// every method so a loading state can be asserted on any of them.
class FakeHouseholdRepository implements HouseholdRepository {
  FakeHouseholdRepository({
    this.result,
    this.error,
    this.delay,
    this.settingsResult,
    this.settingsError,
    this.joinResult,
    this.joinError,
    this.fetchResult,
    this.fetchError,
    this.myHouseholdsResult,
    this.myHouseholdsError,
    this.rotateResult,
    this.rotateError,
    this.leaveResult = true,
    this.leaveError,
    this.deleteResult = true,
    this.deleteError,
    this.neverCompletes = false,
  });

  /// Optional artificial latency applied to **every** method, for asserting
  /// the loading state.
  Duration? delay;

  /// When `true`, every method's `Future` never completes — for asserting a
  /// *permanent* loading state (e.g. a router guard's "still resolving"
  /// branch) without racing a real timer. Deliberately not implemented via a
  /// long [delay]: `Future.delayed` schedules a real `Timer`, which
  /// `flutter_test` asserts is never left pending after a test's widget tree
  /// is disposed — a delay long enough to "never" fire in test time still
  /// leaks that Timer and fails the test on teardown. A [Completer] that is
  /// simply never completed has no Timer to leak.
  final bool neverCompletes;

  // ── createHousehold ────────────────────────────────────────────────────────

  /// Returned by [createHousehold] when [error] is null.
  Household? result;

  /// Thrown by [createHousehold] when set. Takes precedence over [result].
  Object? error;

  /// Every name [createHousehold] was called with, in order.
  final List<String> calls = <String>[];

  // ── updateHouseholdSettings ────────────────────────────────────────────────

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

  // ── joinHousehold ──────────────────────────────────────────────────────────

  /// Returned by [joinHousehold]. Falls back to [result] so a test with one
  /// household to hand does not have to say it twice.
  Household? joinResult;
  Object? joinError;

  /// Every invite code [joinHousehold] was called with, **as the caller passed
  /// it** — the fake does not normalize, so a test can assert that the
  /// *caller* did (or deliberately did not).
  final List<String> joinCalls = <String>[];

  // ── fetchHousehold ─────────────────────────────────────────────────────────

  /// Returned by [fetchHousehold]. Falls back to [result].
  Household? fetchResult;
  Object? fetchError;

  /// Every household id [fetchHousehold] was called with, in order. This is
  /// what `HouseholdSyncPolicy`'s tests count to assert a poll cadence.
  final List<String> fetchCalls = <String>[];

  // ── fetchMyHouseholds ──────────────────────────────────────────────────────

  /// Returned by [fetchMyHouseholds]. No fallback to [result] — an empty list
  /// (the "no households yet" case) is a real, common answer here, and
  /// defaulting to `[result]` would make that case impossible to express.
  List<Household>? myHouseholdsResult;
  Object? myHouseholdsError;

  /// How many times [fetchMyHouseholds] was called — this method takes no
  /// arguments, so a count is all there is to assert.
  int myHouseholdsCallCount = 0;

  // ── rotateInviteCode ───────────────────────────────────────────────────────

  Household? rotateResult;
  Object? rotateError;
  final List<String> rotateCalls = <String>[];

  // ── leaveHousehold ─────────────────────────────────────────────────────────

  bool leaveResult;
  Object? leaveError;
  final List<String> leaveCalls = <String>[];

  // ── deleteHousehold ────────────────────────────────────────────────────────

  bool deleteResult;
  Object? deleteError;

  /// Every `(householdId, confirmationName)` pair, in order. The confirmation
  /// name is recorded verbatim so a test can prove the UI did not trim or
  /// case-fold it on its way here.
  final List<({String householdId, String confirmationName})> deleteCalls =
      <({String householdId, String confirmationName})>[];

  // ── Implementation ─────────────────────────────────────────────────────────

  Future<void> _wait() async {
    if (neverCompletes) {
      await Completer<void>().future;
      return;
    }
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
  }

  /// The one place `error`-beats-`result`-beats-"you forgot to stub it" lives.
  Future<T> _answer<T>(Object? error, T? value, String field) async {
    await _wait();
    if (error != null) {
      throw error;
    }
    if (value == null) {
      throw StateError('FakeHouseholdRepository needs a `$field` or an error.');
    }
    return value;
  }

  @override
  Future<Household> createHousehold(String name) {
    calls.add(name);
    return _answer<Household>(error, result, 'result');
  }

  @override
  Future<HouseholdSettings> updateHouseholdSettings(
    String householdId,
    HouseholdSettingsPatch patch,
  ) {
    settingsCalls.add((householdId: householdId, patch: patch));
    return _answer<HouseholdSettings>(
      settingsError,
      settingsResult ?? result?.settings,
      'settingsResult',
    );
  }

  @override
  Future<Household> joinHousehold(String inviteCode) {
    joinCalls.add(inviteCode);
    return _answer<Household>(joinError, joinResult ?? result, 'joinResult');
  }

  @override
  Future<Household> fetchHousehold(String householdId) {
    fetchCalls.add(householdId);
    return _answer<Household>(fetchError, fetchResult ?? result, 'fetchResult');
  }

  @override
  Future<List<Household>> fetchMyHouseholds() {
    myHouseholdsCallCount++;
    return _answer<List<Household>>(
      myHouseholdsError,
      myHouseholdsResult,
      'myHouseholdsResult',
    );
  }

  @override
  Future<Household> rotateInviteCode(String householdId) {
    rotateCalls.add(householdId);
    return _answer<Household>(
      rotateError,
      rotateResult ?? result,
      'rotateResult',
    );
  }

  @override
  Future<bool> leaveHousehold(String householdId) {
    leaveCalls.add(householdId);
    return _answer<bool>(leaveError, leaveResult, 'leaveResult');
  }

  @override
  Future<bool> deleteHousehold(String householdId, String confirmationName) {
    deleteCalls.add((
      householdId: householdId,
      confirmationName: confirmationName,
    ));
    return _answer<bool>(deleteError, deleteResult, 'deleteResult');
  }
}
