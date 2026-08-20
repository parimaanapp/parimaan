import 'package:mobile/features/household/data/household_repository.dart';
import 'package:mobile/features/household/domain/household.dart';

/// Hand-written [HouseholdRepository] double.
///
/// Hand-written rather than a `mocktail` mock because every test here needs to
/// control *when* the future completes (the Aurora cold-start loading state is
/// a first-class requirement of this slice), which a `thenAnswer` stub makes
/// awkward and this makes explicit.
class FakeHouseholdRepository implements HouseholdRepository {
  FakeHouseholdRepository({this.result, this.error, this.delay});

  /// Returned by [createHousehold] when [error] is null.
  Household? result;

  /// Thrown by [createHousehold] when set. Takes precedence over [result].
  Object? error;

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
}
