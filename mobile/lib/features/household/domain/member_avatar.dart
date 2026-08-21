/// The avatar circle a member is drawn as on the Members list (wireframe 4.2).
///
/// ## Why a scheme had to be invented
///
/// The design system has no avatar component and the wireframe specifies only
/// "circle with the first-letter initial, coloured". Nothing in
/// `lib/shared/ui/` assigns a colour per-identity, so this file defines that
/// mapping rather than letting each call site pick a colour ad hoc — which is
/// how the same person ends up two different colours on two screens.
///
/// ## The scheme
///
/// `colour = palette[stableHash(userId) % palette.length]`, where the palette
/// is five existing `AppColors` tokens and the hash is a hand-rolled FNV-1a
/// over the seed's UTF-16 code units.
///
/// **Why not `String.hashCode`:** Dart makes no promise that `hashCode` is
/// stable across runs or across platforms, and for some types it deliberately
/// is not. A colour that changes when the app restarts is worse than no colour
/// at all, so the hash is written out here where its stability is a property of
/// this code rather than of the runtime.
///
/// **Why the user id and not the name:** the id is immutable. Seeding from the
/// display name would recolour someone the moment they fix a typo in it.
///
/// **Collisions are fine.** With five colours and a five-member cap two members
/// will sometimes share one, and that is acceptable: the colour is a
/// recognition aid next to a name and an initial, never the thing that
/// identifies the person. The initial and the name carry the meaning, per the
/// design system's rule that colour alone never encodes state.
library;

import 'dart:ui' show Color;

import '../../../shared/ui/colors.dart';

/// Shown when a member's label yields no usable first character.
const String memberAvatarFallbackInitial = '?';

/// The five brand tokens avatars are drawn from, in a fixed order.
///
/// Fixed because the order is part of the mapping: reordering this list
/// silently recolours every existing member. All five are existing `AppColors`
/// tokens — no new colour is introduced by this file — and each is dark enough
/// to carry `AppColors.paper` as its foreground.
const List<Color> memberAvatarPalette = <Color>[
  AppColors.terracotta,
  AppColors.cardamom,
  AppColors.haldi,
  AppColors.info,
  AppColors.inkSoft,
];

/// The single character to draw in [label]'s avatar circle.
///
/// Uppercased for Latin scripts and left alone for everything else, where
/// `toUpperCase` is a no-op anyway. Leading whitespace is skipped so a padded
/// name does not render an empty circle.
String memberAvatarInitial(String label) {
  final String trimmed = label.trim();
  if (trimmed.isEmpty) {
    return memberAvatarFallbackInitial;
  }
  return trimmed.substring(0, 1).toUpperCase();
}

/// The palette colour for [seed] — pass a stable identity, i.e. a user id.
///
/// See the library doc for why this hash is written out rather than delegating
/// to `seed.hashCode`.
Color memberAvatarColor(String seed) =>
    memberAvatarPalette[_stableHash(seed) % memberAvatarPalette.length];

/// FNV-1a, 32-bit, over [value]'s code units.
///
/// Masked to 32 bits at each step so the result is identical on the JS and
/// native number representations — an unmasked accumulator would diverge
/// between a web build and a mobile one and recolour everyone.
int _stableHash(String value) {
  const int offsetBasis = 0x811c9dc5;
  const int prime = 0x01000193;
  const int mask = 0xffffffff;

  int hash = offsetBasis;
  for (final int unit in value.codeUnits) {
    hash = (hash ^ unit) & mask;
    hash = (hash * prime) & mask;
  }
  return hash;
}
