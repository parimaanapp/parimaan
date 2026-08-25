import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';

/// Hand-written [PantryRepository] double — same rationale as
/// `fake_household_repository.dart`: explicit control over completion
/// timing (the loading-state requirement) that a `mocktail` stub makes
/// awkward.
class FakePantryRepository implements PantryRepository {
  FakePantryRepository({this.result, this.error, this.delay});

  List<PantryItem>? result;
  Object? error;

  /// Artificial latency applied to every call, for asserting the loading
  /// state.
  Duration? delay;

  /// Every `(householdId, search, category)` triple, in order.
  final List<({String householdId, String? search, String? category})>
  calls = <({String householdId, String? search, String? category})>[];

  @override
  Future<List<PantryItem>> fetchPantry(
    String householdId, {
    String? search,
    String? category,
  }) async {
    calls.add((householdId: householdId, search: search, category: category));
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
    final Object? error = this.error;
    if (error != null) {
      throw error;
    }
    final List<PantryItem>? result = this.result;
    if (result == null) {
      throw StateError('FakePantryRepository needs a `result` or an `error`.');
    }
    return result;
  }
}
