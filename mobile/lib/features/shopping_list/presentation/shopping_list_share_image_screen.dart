import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../data/shopping_list_image_export_repository.dart';
import '../domain/shopping_list_item.dart';
import 'share_sheet_launcher.dart';
import 'shopping_list_share_image.dart';

/// Renders the `RepaintBoundary` attached to [boundaryKey] to PNG bytes,
/// via Flutter's own built-in `RenderRepaintBoundary.toImage()` (D8's
/// locked choice — no image-rendering package). A top-level function, not a
/// method on the screen's state, specifically so
/// [ShoppingListShareImageScreen] can accept it as an injectable
/// [PngCapturer] — real device/widget-test rasterization has its own
/// engine-level timing that a fake can bypass entirely for tests that only
/// care about what happens AROUND the capture (the share-sheet call, the
/// fire-and-forget upload), not the raster pass itself.
Future<Uint8List> captureRepaintBoundaryPng(
  GlobalKey boundaryKey, {
  double pixelRatio = 2.0,
}) async {
  final RenderObject? renderObject = boundaryKey.currentContext
      ?.findRenderObject();
  if (renderObject is! RenderRepaintBoundary) {
    throw StateError(
      'captureRepaintBoundaryPng: the capture boundary was not mounted.',
    );
  }
  final ui.Image image = await renderObject.toImage(pixelRatio: pixelRatio);
  final ByteData? byteData = await image.toByteData(
    format: ui.ImageByteFormat.png,
  );
  if (byteData == null) {
    throw StateError('captureRepaintBoundaryPng: PNG encode failed.');
  }
  return byteData.buffer.asUint8List();
}

/// [captureRepaintBoundaryPng]'s own signature, as an injectable seam.
typedef PngCapturer = Future<Uint8List> Function(GlobalKey boundaryKey);

/// Writes [bytes] to a fresh temp file (`path_provider`'s temp directory,
/// D8's own locked choice for a file to hand `share_plus`) named after
/// [listId]. A top-level function, injectable as [TempPngWriter] for the
/// same reason [captureRepaintBoundaryPng] is: real `dart:io` file I/O has
/// its own async timing that a fake can bypass for tests that only care
/// about what happens around it.
Future<File> writePngTempFile(Uint8List bytes, String listId) async {
  final Directory dir = await getTemporaryDirectory();
  final String path =
      '${dir.path}/shopping-list-$listId-'
      '${DateTime.now().millisecondsSinceEpoch}.png';
  return File(path).writeAsBytes(bytes, flush: true);
}

/// [writePngTempFile]'s own signature, as an injectable seam.
typedef TempPngWriter = Future<File> Function(Uint8List bytes, String listId);

/// Wireframe "Share image preview" (44/50, E2E_MVP_PLAN.md §23.3 S4) — the
/// screen `ShoppingListScreen`'s new Share affordance pushes to. Renders
/// [ShoppingListShareImageContent] inside a `RepaintBoundary`, and its own
/// "Share" button:
///
/// 1. captures that boundary to PNG bytes (`RenderRepaintBoundary.toImage`
///    — Flutter's own built-in mechanism, D8's own locked choice, no new
///    rendering package);
/// 2. writes them to a temp file (`path_provider`) and hands that file to
///    [ShareSheetLauncher], opening the native share sheet;
/// 3. fires the `exportShoppingListImage` backup upload — **fire-and-forget,
///    per D8**: [_uploadBackup]'s own failure is caught and logged only, and
///    is never awaited before step 2's share call returns, so it can never
///    block, delay, or surface an error on the share-sheet flow the user
///    actually came for.
class ShoppingListShareImageScreen extends ConsumerStatefulWidget {
  const ShoppingListShareImageScreen({
    super.key,
    required this.list,
    this.shareSheetLauncher = const RealShareSheetLauncher(),
    this.capturePng = captureRepaintBoundaryPng,
    this.writeTempFile = writePngTempFile,
    this.onBackupUploadError,
  });

  final ShoppingList list;

  /// Overridable for tests — see [ShareSheetLauncher]'s own doc for why this
  /// needs a seam at all.
  final ShareSheetLauncher shareSheetLauncher;

  /// Overridable for tests — see [captureRepaintBoundaryPng]'s own doc.
  /// Defaults to the real thing; production code never overrides this.
  final PngCapturer capturePng;

  /// Overridable for tests — see [writePngTempFile]'s own doc. Defaults to
  /// the real thing; production code never overrides this.
  final TempPngWriter writeTempFile;

  /// Test hook: called instead of the default swallow-and-`debugPrint` when
  /// the fire-and-forget backup upload fails, so a test can observe that it
  /// failed WITHOUT that failure ever reaching a widget/`ScaffoldMessenger`.
  /// `null` (the production default) just logs.
  final void Function(Object error, StackTrace stackTrace)?
  onBackupUploadError;

  static const Key shareButtonKey = Key('shopping-list-share-image-share');
  static const Key captureKey = Key('shopping-list-share-image-boundary');

  @override
  ConsumerState<ShoppingListShareImageScreen> createState() =>
      _ShoppingListShareImageScreenState();
}

class _ShoppingListShareImageScreenState
    extends ConsumerState<ShoppingListShareImageScreen> {
  final GlobalKey _boundaryKey = GlobalKey();
  bool _isSharing = false;

  Future<void> _onSharePressed() async {
    if (_isSharing) return;
    setState(() => _isSharing = true);
    try {
      final Uint8List pngBytes = await widget.capturePng(_boundaryKey);
      final File file = await widget.writeTempFile(pngBytes, widget.list.id);
      await widget.shareSheetLauncher.share(
        ShareParams(
          files: <XFile>[XFile(file.path)],
          subject: 'Shopping list',
        ),
      );
      // Fire-and-forget, deliberately NOT awaited here — D8's own
      // requirement. Any failure inside `_uploadBackup` is caught there and
      // never rethrown, so this `unawaited` is safe even if the widget is
      // disposed before it finishes.
      unawaited(_uploadBackup(pngBytes));
    } finally {
      if (mounted) setState(() => _isSharing = false);
    }
  }

  /// See this class's own doc — never awaited by [_onSharePressed], never
  /// lets an exception escape.
  Future<void> _uploadBackup(Uint8List pngBytes) async {
    try {
      final ShoppingListImageExportRepository repository = ref.read(
        shoppingListImageExportRepositoryProvider,
      );
      final String putUrl = await repository.exportShoppingListImage(
        widget.list.id,
      );
      final http.Response response = await http.put(
        Uri.parse(putUrl),
        headers: const <String, String>{'Content-Type': 'image/png'},
        body: pngBytes,
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw StateError(
          'exportShoppingListImage backup PUT failed with status '
          '${response.statusCode}.',
        );
      }
    } catch (error, stackTrace) {
      if (widget.onBackupUploadError != null) {
        widget.onBackupUploadError!(error, stackTrace);
      } else {
        debugPrint(
          'exportShoppingListImage backup upload failed (fire-and-forget, '
          'no user-facing surface per D8): $error',
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.paper,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            PTopBar(
              title: 'Share image preview',
              onBack: () => context.pop(),
              backSemanticLabel: 'Back to shopping list',
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.s3),
                child: RepaintBoundary(
                  key: _boundaryKey,
                  child: KeyedSubtree(
                    key: ShoppingListShareImageScreen.captureKey,
                    child: ShoppingListShareImageContent(
                      list: widget.list,
                      generatedAt: DateTime.now(),
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: PButton(
                key: ShoppingListShareImageScreen.shareButtonKey,
                label: 'Share',
                icon: Icons.ios_share,
                isLoading: _isSharing,
                expand: true,
                onPressed: _isSharing ? null : _onSharePressed,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
