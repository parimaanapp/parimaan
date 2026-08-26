import 'package:mobile/features/pantry/data/pantry_repository.dart';
import 'package:mobile/features/pantry/domain/pantry_item.dart';
import 'package:mobile/features/pantry/domain/pantry_item_draft.dart';
import 'package:mobile/features/pantry/domain/pantry_item_patch.dart';

/// Hand-written [PantryRepository] double — same rationale as
/// `fake_household_repository.dart`: explicit control over completion
/// timing (the loading-state requirement) that a `mocktail` stub makes
/// awkward, plus one `xResult`/`xError` pair and one call log per method so
/// a test stubbing `addPantryItem` doesn't silently also stub `fetchPantry`.
class FakePantryRepository implements PantryRepository {
  FakePantryRepository({
    this.result,
    this.error,
    this.delay,
    this.addResult,
    this.addError,
    this.updateResult,
    this.updateError,
    this.deleteResult,
    this.deleteError,
  });

  // ── fetchPantry ────────────────────────────────────────────────────────

  List<PantryItem>? result;
  Object? error;

  /// Artificial latency applied to every call, for asserting the loading
  /// state.
  Duration? delay;

  /// Every `(householdId, search, category)` triple, in order.
  final List<({String householdId, String? search, String? category})>
  calls = <({String householdId, String? search, String? category})>[];

  // ── addPantryItem ──────────────────────────────────────────────────────

  PantryItem? addResult;
  Object? addError;
  final List<({String householdId, PantryItemDraft draft})> addCalls =
      <({String householdId, PantryItemDraft draft})>[];

  // ── updatePantryItem ───────────────────────────────────────────────────

  PantryItem? updateResult;
  Object? updateError;
  final List<({String id, PantryItemPatch patch})> updateCalls =
      <({String id, PantryItemPatch patch})>[];

  // ── deletePantryItem ───────────────────────────────────────────────────

  PantryItem? deleteResult;
  Object? deleteError;
  final List<String> deleteCalls = <String>[];

  // ── Implementation ─────────────────────────────────────────────────────

  Future<void> _wait() async {
    final Duration? delay = this.delay;
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
  }

  Future<T> _answer<T>(Object? error, T? value, String field) async {
    await _wait();
    if (error != null) {
      throw error;
    }
    if (value == null) {
      throw StateError('FakePantryRepository needs a `$field` or an error.');
    }
    return value;
  }

  @override
  Future<List<PantryItem>> fetchPantry(
    String householdId, {
    String? search,
    String? category,
  }) {
    calls.add((householdId: householdId, search: search, category: category));
    return _answer<List<PantryItem>>(error, result, 'result');
  }

  @override
  Future<PantryItem> addPantryItem(String householdId, PantryItemDraft draft) {
    addCalls.add((householdId: householdId, draft: draft));
    return _answer<PantryItem>(addError, addResult, 'addResult');
  }

  @override
  Future<PantryItem> updatePantryItem(String id, PantryItemPatch patch) {
    updateCalls.add((id: id, patch: patch));
    return _answer<PantryItem>(updateError, updateResult, 'updateResult');
  }

  @override
  Future<PantryItem> deletePantryItem(String id) {
    deleteCalls.add(id);
    return _answer<PantryItem>(deleteError, deleteResult, 'deleteResult');
  }
}
