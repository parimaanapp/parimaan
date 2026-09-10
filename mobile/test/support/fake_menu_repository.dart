import 'package:mobile/features/menu/data/menu_repository.dart';
import 'package:mobile/features/menu/domain/menu.dart';

/// Hand-written [MenuRepository] double — same rationale and shape as
/// `FakeHouseholdRepository`: one `xResult`/`xError` pair and one call log
/// per method, [error] taking precedence over [result] everywhere.
class FakeMenuRepository implements MenuRepository {
  FakeMenuRepository({
    this.fetchResult,
    this.fetchError,
    this.fetchErrorFromCall,
    this.createResult,
    this.createError,
    this.addResult,
    this.addError,
    this.removeResult = true,
    this.removeError,
    this.previewResult,
    this.previewError,
    this.autoFillResult,
    this.autoFillError,
    this.markMadeResult,
    this.markMadeError,
    this.clearDayResult,
    this.clearDayError,
    this.clearWeekResult,
    this.clearWeekError,
    this.copyDayResult,
    this.copyDayError,
    this.copyWeekResult,
    this.copyWeekError,
    this.delay,
  });

  /// Optional artificial latency applied to every method, for asserting a
  /// loading state.
  Duration? delay;

  // ── fetchMenu ──────────────────────────────────────────────────────────

  /// Returned by [fetchMenu] when [fetchError] is null. `null` (the
  /// default) is itself a valid, meaningful result — "no menu yet" — not an
  /// unconfigured-stub sentinel, matching `MenuRepository.fetchMenu`'s own
  /// contract.
  Menu? fetchResult;
  Object? fetchError;

  /// 1-based call number [fetchError] should first apply from — `null` (the
  /// default) applies it to every call. Lets a test simulate "the initial
  /// read succeeds, a LATER refresh fails" (`CurrentMenuController.refresh`'s
  /// own retry-preserves-last-good-state contract) without a second fake
  /// class.
  int? fetchErrorFromCall;
  final List<(String householdId, DateTime weekStartDate)> fetchCalls =
      <(String, DateTime)>[];

  // ── createMenu ─────────────────────────────────────────────────────────

  /// Falls back to [fetchResult] when unset, so a test that only cares
  /// about the eventual menu doesn't have to set both.
  Menu? createResult;
  Object? createError;
  final List<(String householdId, DateTime weekStartDate)> createCalls =
      <(String, DateTime)>[];

  // ── addMenuItem ────────────────────────────────────────────────────────

  MenuItem? addResult;
  Object? addError;
  final List<(String menuId, NewMenuItem draft)> addCalls =
      <(String, NewMenuItem)>[];

  // ── removeMenuItem ─────────────────────────────────────────────────────

  bool removeResult;
  Object? removeError;
  final List<String> removeCalls = <String>[];

  // ── autoFillPreview ────────────────────────────────────────────────────

  AutoFillPreviewResult? previewResult;
  Object? previewError;
  final List<String> previewCalls = <String>[];

  // ── autoFillWeek ───────────────────────────────────────────────────────

  AutoFillResult? autoFillResult;
  Object? autoFillError;
  final List<(String menuId, bool overwrite, List<NewMenuItem> items)>
  autoFillCalls = <(String, bool, List<NewMenuItem>)>[];

  // ── markMade ───────────────────────────────────────────────────────────

  MenuItem? markMadeResult;
  Object? markMadeError;
  final List<String> markMadeCalls = <String>[];

  // ── clearMenuDay ───────────────────────────────────────────────────────

  ClearMenuResult? clearDayResult;
  Object? clearDayError;
  final List<(String menuId, int dayOfWeek)> clearDayCalls = <(String, int)>[];

  // ── clearMenuWeek ──────────────────────────────────────────────────────

  ClearMenuResult? clearWeekResult;
  Object? clearWeekError;
  final List<String> clearWeekCalls = <String>[];

  // ── copyMenuDay ────────────────────────────────────────────────────────

  CopyMenuResult? copyDayResult;
  Object? copyDayError;
  final List<(String menuId, int fromDay, int toDay)> copyDayCalls =
      <(String, int, int)>[];

  // ── copyMenuWeek ───────────────────────────────────────────────────────

  CopyMenuResult? copyWeekResult;
  Object? copyWeekError;
  final List<(String fromMenuId, DateTime toWeekStartDate)> copyWeekCalls =
      <(String, DateTime)>[];

  @override
  Future<Menu?> fetchMenu(String householdId, DateTime weekStartDate) async {
    fetchCalls.add((householdId, weekStartDate));
    if (delay != null) await Future<void>.delayed(delay!);
    final bool shouldError =
        fetchError != null &&
        (fetchErrorFromCall == null ||
            fetchCalls.length >= fetchErrorFromCall!);
    if (shouldError) throw fetchError!;
    return fetchResult;
  }

  @override
  Future<Menu> createMenu(String householdId, DateTime weekStartDate) async {
    createCalls.add((householdId, weekStartDate));
    if (delay != null) await Future<void>.delayed(delay!);
    if (createError != null) throw createError!;
    final Menu? result = createResult ?? fetchResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.createMenu: no createResult/fetchResult configured.',
      );
    }
    return result;
  }

  @override
  Future<MenuItem> addMenuItem(String menuId, NewMenuItem draft) async {
    addCalls.add((menuId, draft));
    if (delay != null) await Future<void>.delayed(delay!);
    if (addError != null) throw addError!;
    final MenuItem? result = addResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.addMenuItem: no addResult configured.',
      );
    }
    return result;
  }

  @override
  Future<bool> removeMenuItem(String id) async {
    removeCalls.add(id);
    if (delay != null) await Future<void>.delayed(delay!);
    if (removeError != null) throw removeError!;
    return removeResult;
  }

  @override
  Future<AutoFillPreviewResult> autoFillPreview(String menuId) async {
    previewCalls.add(menuId);
    if (delay != null) await Future<void>.delayed(delay!);
    if (previewError != null) throw previewError!;
    final AutoFillPreviewResult? result = previewResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.autoFillPreview: no previewResult configured.',
      );
    }
    return result;
  }

  @override
  Future<AutoFillResult> autoFillWeek(
    String menuId, {
    required bool overwrite,
    required List<NewMenuItem> items,
  }) async {
    autoFillCalls.add((menuId, overwrite, items));
    if (delay != null) await Future<void>.delayed(delay!);
    if (autoFillError != null) throw autoFillError!;
    final AutoFillResult? result = autoFillResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.autoFillWeek: no autoFillResult configured.',
      );
    }
    return result;
  }

  @override
  Future<MenuItem> markMade(String menuItemId) async {
    markMadeCalls.add(menuItemId);
    if (delay != null) await Future<void>.delayed(delay!);
    if (markMadeError != null) throw markMadeError!;
    final MenuItem? result = markMadeResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.markMade: no markMadeResult configured.',
      );
    }
    return result;
  }

  @override
  Future<ClearMenuResult> clearMenuDay(String menuId, int dayOfWeek) async {
    clearDayCalls.add((menuId, dayOfWeek));
    if (delay != null) await Future<void>.delayed(delay!);
    if (clearDayError != null) throw clearDayError!;
    final ClearMenuResult? result = clearDayResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.clearMenuDay: no clearDayResult configured.',
      );
    }
    return result;
  }

  @override
  Future<ClearMenuResult> clearMenuWeek(String menuId) async {
    clearWeekCalls.add(menuId);
    if (delay != null) await Future<void>.delayed(delay!);
    if (clearWeekError != null) throw clearWeekError!;
    final ClearMenuResult? result = clearWeekResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.clearMenuWeek: no clearWeekResult configured.',
      );
    }
    return result;
  }

  @override
  Future<CopyMenuResult> copyMenuDay(
    String menuId,
    int fromDay,
    int toDay,
  ) async {
    copyDayCalls.add((menuId, fromDay, toDay));
    if (delay != null) await Future<void>.delayed(delay!);
    if (copyDayError != null) throw copyDayError!;
    final CopyMenuResult? result = copyDayResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.copyMenuDay: no copyDayResult configured.',
      );
    }
    return result;
  }

  @override
  Future<CopyMenuResult> copyMenuWeek(
    String fromMenuId,
    DateTime toWeekStartDate,
  ) async {
    copyWeekCalls.add((fromMenuId, toWeekStartDate));
    if (delay != null) await Future<void>.delayed(delay!);
    if (copyWeekError != null) throw copyWeekError!;
    final CopyMenuResult? result = copyWeekResult;
    if (result == null) {
      throw StateError(
        'FakeMenuRepository.copyMenuWeek: no copyWeekResult configured.',
      );
    }
    return result;
  }
}
