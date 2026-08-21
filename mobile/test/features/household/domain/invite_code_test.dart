import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/invite_code.dart';

void main() {
  group('normalizeInviteCode', () {
    test('trims surrounding whitespace', () {
      expect(normalizeInviteCode('  K4M9PQ  '), 'K4M9PQ');
    });

    test('uppercases, mirroring the server-side .toUpperCase()', () {
      expect(normalizeInviteCode('k4m9pq'), 'K4M9PQ');
    });

    test('does both, in the server order (trim then uppercase)', () {
      expect(normalizeInviteCode(' k4m9pq '), 'K4M9PQ');
    });

    test('leaves an already-normalized code untouched', () {
      expect(normalizeInviteCode('K4M9PQ'), 'K4M9PQ');
    });
  });

  group('validateInviteCode — length', () {
    test('accepts an exactly-6-character code', () {
      expect(validateInviteCode('K4M9PQ'), isNull);
    });

    test('accepts a code that reaches 6 characters only after trimming', () {
      expect(validateInviteCode('  K4M9PQ '), isNull);
    });

    test('accepts a lowercase code — case is normalized, not rejected', () {
      expect(validateInviteCode('k4m9pq'), isNull);
    });

    test('rejects an empty code', () {
      expect(validateInviteCode(''), isNotNull);
    });

    test('rejects a whitespace-only code', () {
      expect(validateInviteCode('   '), isNotNull);
    });

    test('rejects a 5-character code', () {
      expect(validateInviteCode('K4M9P'), isNotNull);
    });

    test('rejects a 7-character code', () {
      expect(validateInviteCode('K4M9PQR'), isNotNull);
    });

    test('reports the exact length the server enforces', () {
      expect(
        validateInviteCode('K4M9P'),
        'inviteCode must be exactly $inviteCodeLength characters',
      );
    });
  });

  group('validateInviteCode — alphabet is NOT enforced', () {
    // The server's Zod schema checks length only; the excluded characters are
    // a *generation* property, not a validation rule. A client that refused to
    // send a code the server would have accepted is a bug the user cannot work
    // around, so this must stay permissive.
    test('accepts a 6-character code containing an excluded character', () {
      expect(validateInviteCode('K4M9P0'), isNull);
      expect(validateInviteCode('OILOIL'), isNull);
    });
  });

  group('inviteCodeLength / inviteCodeAlphabet', () {
    test(
      'length matches INVITE_CODE_LENGTH in api/src/domain/inviteCode.ts',
      () {
        expect(inviteCodeLength, 6);
      },
    );

    test(
      'alphabet matches INVITE_CODE_ALPHABET, ambiguous glyphs excluded',
      () {
        expect(inviteCodeAlphabet, '23456789ABCDEFGHJKMNPQRSTUVWXYZ');
        expect(inviteCodeAlphabet, hasLength(31));
        for (final String excluded in <String>['0', 'O', '1', 'I', 'L']) {
          expect(
            inviteCodeAlphabet.contains(excluded),
            isFalse,
            reason: '$excluded is ambiguous when read aloud and is excluded',
          );
        }
      },
    );
  });

  group('isInviteCodeCharacter', () {
    test(
      'accepts a character in the generation alphabet, case-insensitively',
      () {
        expect(isInviteCodeCharacter('K'), isTrue);
        expect(isInviteCodeCharacter('k'), isTrue);
        expect(isInviteCodeCharacter('4'), isTrue);
      },
    );

    test('rejects an ambiguous character the generator never emits', () {
      expect(isInviteCodeCharacter('0'), isFalse);
      expect(isInviteCodeCharacter('O'), isFalse);
      expect(isInviteCodeCharacter('l'), isFalse);
    });

    test('rejects punctuation, whitespace and multi-character input', () {
      expect(isInviteCodeCharacter('-'), isFalse);
      expect(isInviteCodeCharacter(' '), isFalse);
      expect(isInviteCodeCharacter(''), isFalse);
      expect(isInviteCodeCharacter('AB'), isFalse);
    });
  });
}
