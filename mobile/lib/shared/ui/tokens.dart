/// Barrel for the Parimaan design tokens.
///
/// Every value re-exported here is a verbatim port of
/// `shared/design-tokens.json`, which is the single source of truth. Nothing
/// in the app may hardcode a hex, a px value, or a duration that has a name in
/// that file — import this barrel instead.
///
/// `test/shared/ui/tokens_test.dart` reads the JSON at test time and fails if
/// any ported value drifts.
///
/// Deliberately does NOT export `theme.dart` — that file builds a `ThemeData`
/// from these tokens rather than being a token itself; import it directly
/// where a `ThemeData` is actually needed (e.g. `MaterialApp.theme`).
library;

export 'colors.dart';
export 'elevation.dart';
export 'motion.dart';
export 'radius.dart';
export 'sizing.dart';
export 'spacing.dart';
export 'typography.dart';
