import 'package:share_plus/share_plus.dart';

/// A thin seam over `SharePlus.instance.share` — exists purely so a widget
/// test can substitute a mock (`share_plus`'s own platform channel has
/// nothing to talk to inside `flutter_test`, same reasoning every other
/// external-plugin boundary in this codebase gets its own interface for,
/// e.g. `ShoppingListRepository` over Ferry). [RealShareSheetLauncher] is
/// the only production implementation; nothing about the interface is
/// feature-specific, so a second share flow elsewhere in the app could
/// reuse it unchanged.
abstract interface class ShareSheetLauncher {
  Future<ShareResult> share(ShareParams params);
}

class RealShareSheetLauncher implements ShareSheetLauncher {
  const RealShareSheetLauncher();

  @override
  Future<ShareResult> share(ShareParams params) =>
      SharePlus.instance.share(params);
}
