import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/household/domain/join_deep_link.dart';
import '../features/household/state/pending_join_code_controller.dart';

/// Where incoming links come from.
///
/// An interface over `app_links` so the listener can be tested without the
/// plugin's platform channels — the same reason `AuthRepository` exists over
/// Amplify. Widget tests override [linkStreamProvider] with a plain
/// `StreamController`.
final Provider<Stream<Uri>> linkStreamProvider = Provider<Stream<Uri>>(
  (Ref ref) => AppLinks().uriLinkStream,
);

/// Watches for `parimaan://join?code=XXXXXX` links and arms the join flow.
///
/// ## What it does, and pointedly does not do
///
/// On a link that [parseJoinDeepLink] accepts, it records the code in
/// [pendingJoinCodeControllerProvider] and nothing else. It does **not** join,
/// and it does not navigate around the auth guard:
///
///  * **No auto-join.** A link that enrolled its recipient into a stranger's
///    household on tap would be a one-click account-linking attack. The user
///    lands on the Enter-code screen with the code prefilled and presses Join
///    themselves. See `join_deep_link.dart`.
///  * **No guard bypass.** Arming the pending code does not authenticate
///    anyone. An unauthenticated deep link still routes through `/sign-in`
///    first; the router resumes the join only inside its already-signed-in
///    branch. See `_redirect` in `router.dart`, and the router test that
///    asserts this property directly.
///  * **No validation of its own.** Link shape is `parseJoinDeepLink`'s job,
///    in one place.
///
/// A link this does not recognise is dropped silently. There is no user to
/// apologise to — they tapped something that was not ours.
class JoinDeepLinkListener extends ConsumerStatefulWidget {
  const JoinDeepLinkListener({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<JoinDeepLinkListener> createState() =>
      _JoinDeepLinkListenerState();
}

class _JoinDeepLinkListenerState extends ConsumerState<JoinDeepLinkListener> {
  StreamSubscription<Uri>? _subscription;

  @override
  void initState() {
    super.initState();
    _subscription = ref
        .read(linkStreamProvider)
        .listen(
          _handle,
          // A failing link stream must not take the app down with it. There is
          // nothing to retry and nothing to tell the user: the app works fine,
          // it just will not receive deep links this run.
          onError: (Object _) {},
        );
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  void _handle(Uri uri) {
    final String? code = parseJoinDeepLink(uri);
    if (code == null) {
      return;
    }
    ref.read(pendingJoinCodeControllerProvider.notifier).set(code);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
