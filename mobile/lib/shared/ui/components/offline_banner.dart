import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../graphql/subscription_client.dart' as subscription_client;
import '../colors.dart';
import '../sizing.dart';
import '../spacing.dart';
import '../typography.dart';

/// How long [AppSyncSubscriptionClient.connectionState] must read
/// `disconnected` **continuously** before [OfflineBanner] renders
/// (E2E_MVP_PLAN.md §18.2.7/O4, locked): the founder-picked midpoint of the
/// drafting pass's own 3–5s range, fixed as an exact named constant rather
/// than left as a range for engineering to interpret.
///
/// Long enough to skip `ReconnectPolicy`'s own 1s-then-2s early rungs (a
/// transient blip that self-heals inside ~4s shouldn't alarm the user at
/// all); short enough that a real disconnect during active use is flagged
/// well before the user would notice something silently failed to sync.
///
/// Applied in one direction only: the debounce gates *showing* the banner
/// while `disconnected` persists. The instant the value reads `connected`
/// again, the banner hides immediately, with no debounce.
const Duration offlineBannerDebounce = Duration(seconds: 4);

/// Wraps [child] with a persistent "you're offline" banner
/// (E2E_MVP_PLAN.md §18.2.7/D7) bound to [connectionState] — in production,
/// [AppSyncSubscriptionClient.connectionState] via `subscriptionClientProvider`,
/// mounted exactly once at the app root (`app.dart`'s `_RoutedApp`, via
/// `MaterialApp.router(builder: ...)`) so every screen gets it without
/// per-screen wiring.
///
/// **Visibility rule, per D7 (locked):**
///  * Shown only once [connectionState] has read
///    [subscription_client.ConnectionState.disconnected] continuously for
///    [offlineBannerDebounce] — never during
///    [subscription_client.ConnectionState.connecting], which is usually the
///    reconnect ladder already working; showing a banner then would read as
///    "something is wrong" during exactly the moment the app is fixing
///    itself.
///  * Hidden immediately — no debounce — the instant [connectionState] reads
///    [subscription_client.ConnectionState.connected].
///  * A value flipping away from `disconnected` before the debounce timer
///    elapses (e.g. straight to `connecting`) cancels the pending timer; the
///    banner never renders for that blip at all.
///
/// A plain [ValueListenable] constructor parameter, not a Riverpod read
/// baked into this widget — same "independently testable without also
/// exercising provider machinery" reasoning `PendingMarkMadeAction` gives for
/// staying a standalone class; `app.dart` supplies the real
/// `subscriptionClientProvider`-backed listenable, tests supply a plain
/// [ValueNotifier].
class OfflineBanner extends StatefulWidget {
  const OfflineBanner({
    super.key,
    required this.connectionState,
    required this.child,
  });

  /// Identifies the banner surface itself, for widget tests.
  static const Key bannerKey = Key('offline_banner');

  final ValueListenable<subscription_client.ConnectionState> connectionState;
  final Widget child;

  @override
  State<OfflineBanner> createState() => _OfflineBannerState();
}

class _OfflineBannerState extends State<OfflineBanner> {
  Timer? _debounceTimer;
  bool _visible = false;

  /// `AppSyncSubscriptionClient._connectionState` defaults to `disconnected`
  /// and only ever leaves it once something actually calls `subscribe()` —
  /// `reconnectNow()` itself no-ops while `_subscriptions` is empty (see its
  /// own doc). That means `disconnected` is also the value on a screen that
  /// has never opened a subscription at all (the sign-in screen; any
  /// authenticated screen before the first subscription-backed controller
  /// mounts) — a state with nothing wrong to report, not a dropped
  /// connection. Without this guard the banner would misfire "you're
  /// offline" a flat [offlineBannerDebounce] after every cold boot,
  /// regardless of whether a connection was ever attempted.
  ///
  /// Set once [connectionState] is observed as anything other than
  /// `disconnected` (i.e. a real `subscribe()` call actually started
  /// connecting) and never cleared — from that point on, `disconnected`
  /// unambiguously means "was connected/connecting, now isn't," which is
  /// exactly what this banner exists to surface.
  bool _hasEverAttemptedConnection = false;

  @override
  void initState() {
    super.initState();
    widget.connectionState.addListener(_handleConnectionStateChanged);
    _handleConnectionStateChanged();
  }

  @override
  void didUpdateWidget(OfflineBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.connectionState != widget.connectionState) {
      oldWidget.connectionState.removeListener(_handleConnectionStateChanged);
      widget.connectionState.addListener(_handleConnectionStateChanged);
      _handleConnectionStateChanged();
    }
  }

  @override
  void dispose() {
    widget.connectionState.removeListener(_handleConnectionStateChanged);
    _debounceTimer?.cancel();
    super.dispose();
  }

  void _handleConnectionStateChanged() {
    final subscription_client.ConnectionState state =
        widget.connectionState.value;

    if (state != subscription_client.ConnectionState.disconnected) {
      _hasEverAttemptedConnection = true;
    }

    if (state == subscription_client.ConnectionState.disconnected) {
      if (!_hasEverAttemptedConnection) {
        // Never actually asked to connect yet — nothing to report as
        // offline. See this field's own doc above.
        return;
      }
      // Already counting down (or already visible): `??=` is defensive
      // rather than reachable through the real listenable today — a plain
      // `ValueNotifier` (what `connectionState` is always backed by, see
      // `AppSyncSubscriptionClient.connectionState`) only calls
      // `notifyListeners()` on an actual value change, so this handler never
      // re-runs for a same-value `disconnected` write. Kept as a guard
      // against restarting the window should a future `ValueListenable`
      // implementation ever notify on a no-op write.
      _debounceTimer ??= Timer(offlineBannerDebounce, () {
        _debounceTimer = null;
        if (!mounted) return;
        setState(() {
          _visible = true;
        });
      });
      return;
    }

    // `connecting` or `connected`: cancel any pending debounce outright (a
    // blip that recovers before the timer fires never shows the banner at
    // all), and hide immediately if already visible — no debounce in this
    // direction, per D7.
    _debounceTimer?.cancel();
    _debounceTimer = null;
    if (_visible) {
      setState(() {
        _visible = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // When the banner is visible, its own `SafeArea` already consumes the
    // top inset (notch/status bar) — `removeTop: true` here stops every
    // screen further down (each of which does its own `SafeArea`) from
    // padding for that same inset a second time, which would otherwise open
    // an extra gap under the banner for as long as it's shown.
    final Widget content = _visible
        ? MediaQuery.removePadding(
            context: context,
            removeTop: true,
            child: widget.child,
          )
        : widget.child;

    return Column(
      children: <Widget>[
        if (_visible) const _OfflineBannerBar(),
        Expanded(child: content),
      ],
    );
  }
}

class _OfflineBannerBar extends StatelessWidget {
  const _OfflineBannerBar();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Container(
        key: OfflineBanner.bannerKey,
        width: double.infinity,
        color: AppColors.warning,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s2,
          vertical: AppSpacing.s1,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(
              Icons.cloud_off,
              size: AppSizing.icon20,
              color: AppColors.ink,
            ),
            const SizedBox(width: AppSpacing.s1),
            Flexible(
              child: Text(
                "You're offline — showing the last synced data.",
                style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
