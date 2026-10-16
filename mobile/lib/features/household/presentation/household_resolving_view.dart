import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/components/components.dart';
import '../domain/household.dart';
import '../state/me_households_controller.dart';

/// How long a household-scoped screen may show its spinner while waiting for
/// `activeHouseholdProvider` before it offers a Retry instead. A provider so
/// widget tests can shorten it.
final Provider<Duration> householdResolveTimeoutProvider = Provider<Duration>(
  (Ref ref) => const Duration(seconds: 15),
);

/// What a household-scoped tab (Today, Recipes, Plan, Pantry...) shows while
/// `activeHouseholdProvider` is still null.
///
/// It must never spin forever: a spinner is only honest while the
/// me-households query is actually in flight and has not been in flight for
/// longer than [householdResolveTimeoutProvider]. Otherwise (the query
/// errored, came back with no household for this session, or is just stuck)
/// it shows a message with a Retry that refetches the list.
class HouseholdResolvingView extends ConsumerStatefulWidget {
  const HouseholdResolvingView({super.key, this.loadingKey});

  /// Key for the spinner, so each host screen keeps its existing test hook.
  final Key? loadingKey;

  static const Key retryStateKey = Key('household-resolving-retry');

  @override
  ConsumerState<HouseholdResolvingView> createState() =>
      _HouseholdResolvingViewState();
}

class _HouseholdResolvingViewState
    extends ConsumerState<HouseholdResolvingView> {
  Timer? _timer;
  bool _timedOut = false;

  @override
  void initState() {
    super.initState();
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    _timedOut = false;
    _timer = Timer(ref.read(householdResolveTimeoutProvider), () {
      if (mounted) {
        setState(() => _timedOut = true);
      }
    });
  }

  void _retry() {
    ref.invalidate(meHouseholdsControllerProvider);
    setState(_startTimer);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Household>> me = ref.watch(
      meHouseholdsControllerProvider,
    );
    if (me.isLoading && !_timedOut) {
      return Center(
        key: widget.loadingKey,
        child: const CircularProgressIndicator(),
      );
    }
    return Center(
      key: HouseholdResolvingView.retryStateKey,
      child: PEmptyState(
        headline: 'Could not load your household',
        body: 'Check your connection and try again.',
        action: PButton(
          label: 'Try again',
          variant: PButtonVariant.secondary,
          onPressed: _retry,
        ),
      ),
    );
  }
}
