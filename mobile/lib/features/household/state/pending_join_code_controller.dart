import 'package:flutter_riverpod/flutter_riverpod.dart';

/// An invite code that arrived by deep link and has not been consumed yet.
///
/// ## Why this exists at all: the deep link must not outrank the auth guard
///
/// A `parimaan://join?code=XXXXXX` link can arrive while the app is signed
/// out. The router's redirect will — correctly, and without any special-casing
/// for deep links — bounce that navigation to `/sign-in`. If the code lived
/// only in the URL, that bounce would destroy it, and the user would finish
/// signing in on the first-run screen with no idea what happened to the invite
/// they tapped.
///
/// So the code is held *here* instead: in state that survives the redirect. The
/// guard stays exactly as strict as it was — an unauthenticated deep link still
/// goes to sign-in first, every time — and the router consults this afterwards
/// to resume the interrupted journey. **This is a resume mechanism, not a
/// bypass**, and the router test asserts precisely that distinction.
///
/// ## Consumed exactly once
///
/// [take] returns the code and clears it in the same step. Without that, the
/// join flow would re-arm itself on every navigation and the user could never
/// leave it — every attempt to go elsewhere would be redirected straight back.
class PendingJoinCodeController extends Notifier<String?> {
  @override
  String? build() => null;

  /// Records a code parsed from a deep link.
  ///
  /// Only ever called with a value that already passed `parseJoinDeepLink`, so
  /// this does no validation of its own — re-checking here would put the
  /// link-shape rules in two places.
  void set(String code) => state = code;

  /// Returns the pending code and clears it. See the class doc.
  String? take() {
    final String? code = state;
    state = null;
    return code;
  }

  /// Drops a pending code without acting on it — the user navigated away.
  void clear() => state = null;
}

final NotifierProvider<PendingJoinCodeController, String?>
pendingJoinCodeControllerProvider =
    NotifierProvider<PendingJoinCodeController, String?>(
      PendingJoinCodeController.new,
    );
