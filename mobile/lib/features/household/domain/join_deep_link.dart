/// Parsing for the `parimaan://join?code=XXXXXX` invite deep link.
///
/// ## A deep link is untrusted input
///
/// Anything can hand the app a `Uri` — a QR code, a WhatsApp forward, another
/// installed app, a web page. So this file's job is not "extract the code" but
/// **"decide whether this link is one of ours, and whether what it carries
/// could possibly be a real invite code"**. Everything it cannot vouch for is
/// answered with `null`, and a `null` means the app ignores the link entirely
/// rather than acting on a fraction of it.
///
/// ## Stricter than `validateInviteCode`, deliberately
///
/// `invite_code.dart` explicitly does **not** check the code alphabet, because
/// the server does not either and a client that refuses input the server would
/// accept is a bug the user cannot work around. That reasoning applies to a
/// code the user *typed*. It does not apply here: a deep-link code is not a
/// user's keystrokes, it is a payload from outside, and refusing to prefill
/// from a string containing characters the generator can never emit costs a
/// legitimate user nothing — the six-box field is still right there — while
/// keeping arbitrary attacker-chosen text out of the entry field.
///
/// ## What this file deliberately does NOT do
///
/// It does not join anything. Parsing a link yields a *code*, never a
/// membership: the flow lands the user on the Enter-code screen with the code
/// prefilled and an explicit "Join" they must press. A link that silently
/// enrolled its recipient into a stranger's household on tap would be a
/// one-click account-linking attack, and the confirmation tap is what makes it
/// not one.
library;

import 'invite_code.dart';

/// The custom scheme registered by the iOS/Android manifests.
const String joinDeepLinkScheme = 'parimaan';

/// The https host the universal/app-link form uses. Only this exact host is
/// honoured — a link from any other domain is not ours, whatever it claims.
const String joinDeepLinkHost = 'parimaan.app';

/// The single path/action this file recognises.
const String joinDeepLinkAction = 'join';

/// The query parameter carrying the invite code.
const String joinDeepLinkCodeParameter = 'code';

/// The invite code carried by [uri], or `null` if [uri] is not a join link
/// this app should act on.
///
/// The returned code is already normalized the way the server normalizes it
/// (trimmed, uppercased), so it can be handed straight to the entry field.
String? parseJoinDeepLink(Uri uri) {
  if (!_isJoinLink(uri)) {
    return null;
  }

  final String? raw = uri.queryParameters[joinDeepLinkCodeParameter];
  if (raw == null) {
    return null;
  }

  final String code = normalizeInviteCode(raw);
  if (code.length != inviteCodeLength) {
    return null;
  }
  // See the library doc: stricter than `validateInviteCode` on purpose.
  if (!code.split('').every(isInviteCodeCharacter)) {
    return null;
  }
  return code;
}

/// Whether [uri] addresses *this* app's join action.
///
/// Two accepted shapes, and nothing else:
///
///  * `parimaan://join?...` — the custom scheme. The action sits in the URI's
///    **host** for a scheme with no authority, which is why this reads `host`
///    and not `path`.
///  * `https://parimaan.app/join?...` — the universal/app-link form, so a code
///    shared as a tappable web URL works for someone who has the app and
///    degrades to a web page for someone who does not.
bool _isJoinLink(Uri uri) {
  final String scheme = uri.scheme.toLowerCase();

  if (scheme == joinDeepLinkScheme) {
    return uri.host.toLowerCase() == joinDeepLinkAction;
  }
  if (scheme == 'https') {
    return uri.host.toLowerCase() == joinDeepLinkHost &&
        uri.pathSegments.length == 1 &&
        uri.pathSegments.first.toLowerCase() == joinDeepLinkAction;
  }
  return false;
}
