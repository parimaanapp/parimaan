import 'dart:async';
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/sizing.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/frame_brightness.dart';
import '../domain/pantry_photo_compression.dart';

/// W19 §26.1 — the camera screen reached from `pantry_photo_tips_screen.dart`.
/// Scope boundary, named explicitly per that slice's own doc: this screen's
/// only job is producing one compressed (`pantry_photo_compression.dart`,
/// SD:1274's locked 1024px/JPEG q80), guidance-following photo and handing
/// its bytes to [onCaptured]. It does not upload anything, call
/// `analyzePantryPhoto`, or know that resolver exists — that wiring is a
/// separate, later, not-yet-planned W20 slice.
///
/// **Not verified against real camera hardware in the session that wrote
/// this** — the `camera` plugin's real behavior (permission prompts, actual
/// preview rendering, real `CameraImage` plane layout on a physical device)
/// needs a real device/simulator pass before this ships, per this file's
/// own §26.1 "Verification" line. Built directly against the installed
/// `camera` package's real (checked, not guessed) API surface, but that is
/// necessary, not sufficient, verification.
///
/// The live darkness warning is deliberately non-blocking (a banner, not a
/// disabled shutter) — `frame_brightness.dart`'s own doc explains why: its
/// threshold was found NOT empirically supported by whole-frame JPEG
/// analysis of this app's real photo corpus, so blocking the shutter on an
/// unverified number would risk stopping a user from taking a perfectly
/// good photo. A warning they can act on or dismiss by proceeding anyway is
/// the honest amount of confidence this threshold currently deserves.
class PantryPhotoCaptureScreen extends StatefulWidget {
  const PantryPhotoCaptureScreen({super.key, required this.onCaptured, this.onBack});

  /// Called with the final compressed JPEG bytes once the user captures and
  /// this screen finishes compressing them.
  final ValueChanged<Uint8List> onCaptured;
  final VoidCallback? onBack;

  static const Key shutterButtonKey = Key('pantry-photo-capture-shutter');
  static const Key darkWarningKey = Key('pantry-photo-capture-dark-warning');
  static const Key backButtonKey = Key('pantry-photo-capture-back');

  /// Only every Nth image-stream frame is sampled for brightness — a real
  /// camera stream runs ~30fps, and brightness doesn't change fast enough
  /// to need per-frame precision; sampling every frame would just burn CPU
  /// on the UI isolate for no real benefit to the warning's responsiveness.
  static const int brightnessSampleEveryNFrames = 10;

  @override
  State<PantryPhotoCaptureScreen> createState() => _PantryPhotoCaptureScreenState();
}

class _PantryPhotoCaptureScreenState extends State<PantryPhotoCaptureScreen> {
  CameraController? _controller;
  Object? _initError;
  bool _isTooDark = false;
  bool _isCapturing = false;
  int _frameCounter = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_initCamera());
  }

  Future<void> _initCamera() async {
    try {
      final List<CameraDescription> cameras = await availableCameras();
      if (cameras.isEmpty) {
        throw StateError('No cameras available on this device.');
      }
      final CameraDescription camera = cameras.firstWhere(
        (CameraDescription c) => c.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      final CameraController controller = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
      );
      await controller.initialize();
      await controller.startImageStream(_onFrame);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _controller = controller);
    } catch (error) {
      // Found on the iOS Simulator (no camera hardware): the raw error text
      // ("Bad state: No cameras available…") must not reach the user.
      debugPrint('PantryPhotoCaptureScreen: camera init failed: $error');
      if (mounted) {
        setState(() => _initError = error);
      }
    }
  }

  void _onFrame(CameraImage image) {
    _frameCounter++;
    if (_frameCounter % PantryPhotoCaptureScreen.brightnessSampleEveryNFrames != 0) {
      return;
    }
    if (image.planes.isEmpty) {
      return;
    }
    final double luma = averageLuma(image.planes.first.bytes);
    final bool tooDark = isFrameTooDark(luma);
    if (tooDark != _isTooDark && mounted) {
      setState(() => _isTooDark = tooDark);
    }
  }

  Future<void> _capture() async {
    final CameraController? controller = _controller;
    if (controller == null || _isCapturing) {
      return;
    }
    setState(() => _isCapturing = true);
    try {
      final XFile file = await controller.takePicture();
      final Uint8List rawBytes = await file.readAsBytes();
      final Uint8List compressed = compressPantryPhoto(rawBytes);
      widget.onCaptured(compressed);
    } finally {
      if (mounted) {
        setState(() => _isCapturing = false);
      }
    }
  }

  @override
  void dispose() {
    final CameraController? controller = _controller;
    if (controller != null) {
      if (controller.value.isStreamingImages) {
        unawaited(controller.stopImageStream());
      }
      unawaited(controller.dispose());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final CameraController? controller = _controller;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  if (controller != null)
                    CameraPreview(controller, child: const _FramingOverlay())
                  else
                    Center(
                      child: _initError != null
                          ? const _CameraUnavailable()
                          : const CircularProgressIndicator(color: Colors.white),
                    ),
                  if (_isTooDark)
                    Positioned(
                      top: AppSpacing.s3,
                      left: AppSpacing.s3,
                      right: AppSpacing.s3,
                      child: const _DarkFrameWarning(key: PantryPhotoCaptureScreen.darkWarningKey),
                    ),
                  Positioned(
                    top: AppSpacing.s2,
                    left: AppSpacing.s2,
                    child: _BackCircleButton(
                      key: PantryPhotoCaptureScreen.backButtonKey,
                      onTap: widget.onBack ?? () => Navigator.of(context).pop(),
                    ),
                  ),
                ],
              ),
            ),
            Container(
              color: AppColors.paper,
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: PButton(
                key: PantryPhotoCaptureScreen.shutterButtonKey,
                label: 'Take photo',
                isLoading: _isCapturing,
                loadingLabel: 'Capturing…',
                onPressed: controller == null || _isCapturing ? null : _capture,
                expand: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A static rectangle guide suggesting "fill this with one shelf" — pure
/// UI, no measurement or detection. §26.1's own rejected-from-scope note:
/// real-time clutter detection is a meaningfully bigger build, deferred.
class _FramingOverlay extends StatelessWidget {
  const _FramingOverlay();

  @override
  Widget build(BuildContext context) => Center(
    child: FractionallySizedBox(
      widthFactor: 0.85,
      heightFactor: 0.55,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: Colors.white70, width: 2),
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    ),
  );
}

class _DarkFrameWarning extends StatelessWidget {
  const _DarkFrameWarning({super.key});

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Colors.black.withValues(alpha: 0.75),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2, vertical: AppSpacing.s1),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.wb_incandescent_outlined, color: Colors.white, size: 18),
          const SizedBox(width: AppSpacing.s1),
          Expanded(
            child: Text(
              'This looks dark — try more light or flash',
              style: AppTypography.label.copyWith(color: Colors.white),
            ),
          ),
        ],
      ),
    ),
  );
}

class _BackCircleButton extends StatelessWidget {
  const _BackCircleButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Back',
    child: InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Container(
        width: AppSizing.minTouchTargetWidth,
        height: AppSizing.minTouchTargetWidth,
        decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.5), shape: BoxShape.circle),
        child: const Icon(Icons.arrow_back, color: Colors.white),
      ),
    ),
  );
}

class _CameraUnavailable extends StatelessWidget {
  const _CameraUnavailable();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(AppSpacing.s3),
    child: Text(
      'Camera unavailable. You can add pantry items manually instead.',
      textAlign: TextAlign.center,
      style: AppTypography.body.copyWith(color: Colors.white),
    ),
  );
}
