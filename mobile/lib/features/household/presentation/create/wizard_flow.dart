import '../../../../app/router.dart';

/// Why a wizard screen is on screen: first-time setup, or editing later.
enum WizardFlow {
  /// The create wizard, screens 2.2–2.6 walked in order.
  create,

  /// Entered from the Settings hub (wireframe 4.1) to change one thing.
  edit,
}

/// The handful of decisions that differ between the two flows.
///
/// ## Why the wizard screens are reused rather than copied
///
/// Settings rows "Meal structure", "Cuisine preferences", "Dietary tags" and
/// "Allergens & skip list" edit exactly the fields wizard screens 2.3–2.6
/// already edit, through exactly the same `updateHouseholdSettings` patches.
/// Building second copies would mean two widgets per preference, drifting
/// apart the first time a chip is added to one of them.
///
/// But the wizard screens are not flow-agnostic as written: each hard-codes
/// where Continue goes and where Back goes, both of which are wrong when the
/// screen was opened from Settings. This type is the seam that fixes that —
/// **one constructor parameter per screen**, defaulting to
/// [WizardFlow.create], so the create wizard is untouched and the edit entry
/// points pass an [WizardFlowContext.edit] instead.
///
/// A widget parameter rather than a Riverpod provider on purpose: the flow is a
/// property of *how this screen was routed to*, which is exactly what a
/// constructor argument expresses. A provider would make it ambient state that
/// two screens could disagree about, and would need a nested `ProviderScope` at
/// every edit route to boot.
///
/// ## What differs
///
/// | | create | edit |
/// |---|---|---|
/// | Step indicator | "2/4" | none — there is no sequence |
/// | Action label | "Continue" | "Save" |
/// | After submit | the next wizard step | back to the Settings hub |
/// | Back | the previous wizard step | back to the Settings hub |
class WizardFlowContext {
  /// The create wizard. The default everywhere, so no existing call site
  /// changes.
  const WizardFlowContext.create()
    : flow = WizardFlow.create,
      householdId = null;

  /// Editing [householdId]'s settings from the Settings hub.
  const WizardFlowContext.edit(String this.householdId)
    : flow = WizardFlow.edit;

  final WizardFlow flow;

  /// The household being edited. Non-null exactly when [flow] is
  /// [WizardFlow.edit] — enforced by the two constructors rather than by an
  /// assertion, so the impossible combination cannot be written.
  final String? householdId;

  bool get isEditing => flow == WizardFlow.edit;

  /// "Continue" while walking the wizard; "Save" when changing one setting.
  ///
  /// "Save" matters: in the edit flow there is nothing to continue *to*, and a
  /// button labelled Continue would imply a next step that does not exist.
  String get actionLabel => isEditing ? 'Save' : 'Continue';

  /// The "2/4" progress text, suppressed when editing — a single screen
  /// reached from Settings is not step 2 of anything.
  String? stepIndicator(String whenCreating) => isEditing ? null : whenCreating;

  /// Where a successful submit goes.
  String destination({required String whenCreating}) =>
      isEditing ? AppRoutes.settingsHub(householdId!) : whenCreating;

  /// Where Back goes.
  String backDestination({required String whenCreating}) =>
      isEditing ? AppRoutes.settingsHub(householdId!) : whenCreating;

  /// The back button's screen-reader label.
  String backSemanticLabel({required String whenCreating}) =>
      isEditing ? 'Back to settings' : whenCreating;
}
