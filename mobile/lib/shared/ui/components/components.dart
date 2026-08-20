/// Barrel for the Parimaan shared UI components — the ten primitives named in
/// `E2E_MVP_PLAN.md` §3, Phase 1 exit criteria.
///
/// Every component in this directory obeys four rules:
///
/// 1. **Every visual value is a token.** No hex, no pixel literal, no raw
///    duration — always `AppColors` / `AppSpacing` / `AppRadius` / `AppMotion`
///    / `AppTypography` / `AppSizing`, which are verbatim ports of
///    `shared/design-tokens.json`.
/// 2. **Stateless and provider-free.** Data and callbacks arrive through the
///    constructor; nothing here reads a Riverpod provider or holds mutable
///    state. That is what makes the set golden-testable in isolation and
///    reusable from every feature.
/// 3. **44pt touch targets on anything interactive**, from
///    `AppSizing.minTouchTargetWidth` / `.buttonMinHeight`.
/// 4. **Colour never carries meaning alone.** Every state-bearing component
///    pairs its colour with text or a glyph.
///
/// ## Copy and i18n
///
/// Every piece of user-facing text is a `String` parameter. `E2E_MVP_PLAN.md`
/// locked decision Q6 calls for an ARB/`flutter_intl` string layer scaffolded
/// in W2, but **no such scaffolding exists in this repo yet** — there is no
/// `mobile/l10n.yaml` and no `mobile/lib/l10n/`. Rather than block this slice
/// on building it, components accept plain strings, which is exactly the shape
/// a generated `AppLocalizations` getter will hand them later. No component
/// hard-codes English UI copy. The only literals in this directory are
/// typographic glyphs the design source itself draws — `‹`, `✓`, `×` — which
/// are brand/iconographic, not translatable copy, and each of which is
/// overridable and paired with a caller-supplied screen-reader label.
library;

export 'p_badge.dart';
export 'p_button.dart';
export 'p_card.dart';
export 'p_chip.dart';
export 'p_empty_state.dart';
export 'p_icon_button.dart';
export 'p_input.dart';
export 'p_tab_bar.dart';
export 'p_toast.dart';
export 'p_top_bar.dart';
