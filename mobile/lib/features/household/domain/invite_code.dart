/// Client-side shape rules for a household invite code.
///
/// ## This is fast feedback, not a gate
///
/// Exactly the position `household_name.dart` takes, for exactly the same
/// reasons: **the server remains the authority.** This exists so a five-
/// character code is caught in milliseconds rather than after a round trip
/// which, against a cold Aurora Serverless v2 instance, can take ~30 seconds.
/// It is used by the presentation layer to enable/disable a button and to
/// render an inline message; it is deliberately *not* used by
/// `HouseholdRepository` to short-circuit `joinHousehold`.
///
/// ## Ported from `api/src/validation/joinHousehold.ts`
///
/// That schema is `z.string().trim().toUpperCase().length(6)` — three steps,
/// in that order, and [normalizeInviteCode] plus [validateInviteCode]
/// reproduce them so identical input produces an identical message on both
/// sides.
///
/// ## What is deliberately NOT validated: the alphabet
///
/// `api/src/domain/inviteCode.ts` generates codes from a 31-character
/// alphabet that excludes `0`, `O`, `1`, `I` and `L` — glyphs that are
/// ambiguous when a household member reads a code aloud or writes it on paper.
/// That is a property of *generation*, and the server's validator does **not**
/// check it: a code containing `0` is simply a code that will not match any
/// row, and the server answers `NOT_FOUND`.
///
/// So [validateInviteCode] does not check it either. A client that refuses to
/// send input the server would have accepted is a bug the user cannot work
/// around — and if the alphabet is ever widened server-side, an over-strict
/// client would reject perfectly good codes until it shipped an update.
///
/// [isInviteCodeCharacter] exposes the alphabet anyway, but for a different
/// job: the six-box entry field uses it to *filter keystrokes* as they are
/// typed, which stops a typo before it becomes a code rather than rejecting a
/// finished one.
library;

/// The exact code length the server enforces.
///
/// Must stay equal to `INVITE_CODE_LENGTH` in `api/src/domain/inviteCode.ts`.
/// `invite_code_test.dart` asserts the literal, so a server-side change not
/// mirrored here fails a test rather than becoming a confusing rejection at
/// runtime.
const int inviteCodeLength = 6;

/// The 31 characters the server's generator draws from — uppercase letters
/// and digits, minus the ambiguous `0`, `O`, `1`, `I`, `L`.
///
/// Must stay equal to `INVITE_CODE_ALPHABET` in
/// `api/src/domain/inviteCode.ts`. See the library doc for why this is used
/// for keystroke filtering and *not* for validation.
const String inviteCodeAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/// [raw] as the server will see it: trimmed, then uppercased.
///
/// Order matters and matches the server's chain. Uppercasing first would let
/// a trailing space survive into the length check on one side but not the
/// other.
String normalizeInviteCode(String raw) => raw.trim().toUpperCase();

/// Returns the message the server would return for [raw], or `null` when the
/// code is the right shape.
///
/// Length only — see the library doc for why the alphabet is not checked here.
String? validateInviteCode(String raw) {
  if (normalizeInviteCode(raw).length != inviteCodeLength) {
    return 'inviteCode must be exactly $inviteCodeLength characters';
  }
  return null;
}

/// Whether [character] is a single character the generator could have emitted,
/// ignoring case.
///
/// For the six-box entry field's input filter, not for validation. Returns
/// `false` for the empty string and for anything longer than one character —
/// a caller feeding this more than one character is asking the wrong question.
bool isInviteCodeCharacter(String character) {
  if (character.length != 1) {
    return false;
  }
  return inviteCodeAlphabet.contains(character.toUpperCase());
}
