/// The longest household name the server accepts.
///
/// Must stay equal to `MAX_NAME_LENGTH` in
/// `api/src/validation/createHousehold.ts`. `household_name_test.dart` asserts
/// the literal, so a server-side change that is not mirrored here fails a test
/// rather than turning into a confusing server rejection at runtime.
const int maxHouseholdNameLength = 60;

/// Rejects ASCII control characters (0x00-0x1F, 0x7F), matching
/// `hasControlCharacters` in the server's validator. Unicode is intentionally
/// allowed: Indian-kitchen households commonly name themselves in Hindi or a
/// regional script, and emoji are fine.
final RegExp _controlCharacters = RegExp(r'[\x00-\x1F\x7F]');

/// Validates a household name the way `createHouseholdArgsSchema` does, and
/// returns the same message the server would — or `null` when it is valid.
///
/// ## This is fast feedback, not a gate
///
/// **The server remains the authority.** This exists so a typo is caught in
/// milliseconds instead of after a round trip that, against a cold Aurora
/// Serverless v2 instance, can take ~30 seconds. It is used by the presentation
/// layer to render an inline error before dispatching; it is deliberately
/// *not* used by `HouseholdRepository` to short-circuit the mutation. Two
/// reasons: the two implementations can drift (this file is a hand-port of a
/// Zod schema in another language, in another package, with no shared test),
/// and a client that refuses to send a request the server would have accepted
/// is a bug the user cannot work around.
///
/// Order matches the server's `.trim().min(1).max(60).refine(...)` chain
/// exactly, so identical input produces an identical message on both sides.
String? validateHouseholdName(String name) {
  final String trimmed = name.trim();

  if (trimmed.isEmpty) {
    return 'name must not be empty';
  }
  if (trimmed.length > maxHouseholdNameLength) {
    return 'name must be at most $maxHouseholdNameLength characters';
  }
  if (_controlCharacters.hasMatch(trimmed)) {
    return 'name must not contain control characters';
  }
  return null;
}
