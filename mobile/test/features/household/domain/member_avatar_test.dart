import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/member_avatar.dart';
import 'package:mobile/shared/ui/colors.dart';

void main() {
  group('memberAvatarInitial', () {
    test('is the first letter of the label, uppercased', () {
      expect(memberAvatarInitial('Asha'), 'A');
      expect(memberAvatarInitial('priya'), 'P');
    });

    test('skips leading whitespace rather than rendering a blank circle', () {
      expect(memberAvatarInitial('  Raj'), 'R');
    });

    test('falls back to a placeholder for an unusable label', () {
      expect(memberAvatarInitial(''), memberAvatarFallbackInitial);
      expect(memberAvatarInitial('   '), memberAvatarFallbackInitial);
    });

    test('takes the first character of a non-Latin label as-is', () {
      // No transliteration: uppercasing a Devanagari string is a no-op, and
      // the first grapheme is still the right glyph to show.
      expect(memberAvatarInitial('आशा'), 'आ');
    });
  });

  group('memberAvatarColor', () {
    test('is stable for the same seed across calls', () {
      expect(memberAvatarColor('user-1'), memberAvatarColor('user-1'));
    });

    test('only ever returns a palette token, never an invented colour', () {
      for (final String seed in <String>[
        'user-1',
        'user-2',
        'user-3',
        'user-4',
        'user-5',
        '',
        'a-very-long-cognito-sub-0000-1111-2222',
      ]) {
        expect(memberAvatarPalette, contains(memberAvatarColor(seed)));
      }
    });

    test('the palette is drawn entirely from AppColors', () {
      const List<Object> tokens = <Object>[
        AppColors.terracotta,
        AppColors.cardamom,
        AppColors.haldi,
        AppColors.info,
        AppColors.inkSoft,
      ];
      for (final Object colour in memberAvatarPalette) {
        expect(tokens, contains(colour));
      }
    });

    test('spreads a realistic five-member household over >1 colour', () {
      // The cap is 5 members, so a scheme that collapsed a whole household to
      // one colour would defeat the point of colouring at all.
      final Set<Object> distinct = <String>[
        'user-1',
        'user-2',
        'user-3',
        'user-4',
        'user-5',
      ].map(memberAvatarColor).toSet();

      expect(distinct.length, greaterThan(1));
    });

    test(
      'an empty seed still yields a palette colour rather than throwing',
      () {
        expect(memberAvatarPalette, contains(memberAvatarColor('')));
      },
    );
  });
}
