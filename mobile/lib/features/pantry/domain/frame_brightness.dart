/// W19 §26.1 — the pure half of the live capture-screen brightness check.
/// Computes average luma (brightness, 0-255) from a camera frame's Y-plane
/// bytes, kept separate from the camera-plugin-coupled capture screen so
/// it's unit-testable without a real camera (matching this codebase's own
/// "pure domain function, thin presentation wrapper" convention throughout
/// `pantry/domain/`).
///
/// Y-plane bytes (unsigned, one per pixel) rather than a decoded image —
/// matches what Flutter's `camera` plugin exposes per-frame on Android's
/// `yuv420` image-stream format (iOS delivers BGRA; the capture screen is
/// responsible for picking the right plane/channel per platform, not this
/// function).
library;

/// Returns the mean of [yPlaneBytes], or `0` for an empty frame (never
/// throws — a malformed/empty frame should read as "definitely too dark,
/// prompt a retake" rather than crash the capture screen).
double averageLuma(List<int> yPlaneBytes) {
  if (yPlaneBytes.isEmpty) {
    return 0;
  }
  final int sum = yPlaneBytes.fold<int>(0, (int acc, int byte) => acc + byte);
  return sum / yPlaneBytes.length;
}

/// **Not empirically verified against real photos** — attempted during
/// W19's own review (computing average luma for the 6 real photos that
/// returned zero vision-proposed items vs. 5 real high-yield photos, via
/// PIL) and found the two groups' brightness ranges almost completely
/// overlap (84–136 vs. 98–138). A saved JPEG has already been
/// auto-exposure-corrected by the phone's own camera pipeline, so it isn't
/// a valid proxy for what a *live, pre-processing* camera frame looks like
/// — this constant is a starting point for on-device tuning once the real
/// capture screen exists, not a value this session's data supports.
const double unverifiedDarkFrameLumaThreshold = 50;

/// `true` when [averageLuma] falls at or below [threshold] — the capture
/// screen's own decision of what to do with that (block the shutter, show
/// a non-blocking warning) is deliberately not this function's job.
bool isFrameTooDark(double averageLuma, {double threshold = unverifiedDarkFrameLumaThreshold}) =>
    averageLuma <= threshold;
