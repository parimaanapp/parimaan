/// Whether a pantry item counts as "running low".
///
/// The locked formula (E2E_MVP_PLAN.md §11.2.6): an absolute quantity in the
/// item's own unit, compared against its own `lowThreshold`. `PRD.md` §7.1
/// offers a second definition — quantity under 20% of a user-defined
/// "typical" quantity — but that needs a `typical_quantity` column that does
/// not exist, so it is not implemented. `null` (no threshold set) always
/// reads as not-running-low, never as a false positive.
bool isRunningLow({required num quantity, required num? lowThreshold}) =>
    lowThreshold != null && quantity <= lowThreshold;
