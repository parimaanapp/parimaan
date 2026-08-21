import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/household/domain/join_deep_link.dart';

void main() {
  group('parseJoinDeepLink — accepts', () {
    test('the canonical parimaan://join?code=XXXXXX form', () {
      expect(
        parseJoinDeepLink(Uri.parse('parimaan://join?code=K4M9PQ')),
        'K4M9PQ',
      );
    });

    test('normalizes case and surrounding whitespace, like the server', () {
      expect(
        parseJoinDeepLink(Uri.parse('parimaan://join?code=k4m9pq')),
        'K4M9PQ',
      );
      expect(
        parseJoinDeepLink(Uri.parse('parimaan://join?code=%20k4m9pq%20')),
        'K4M9PQ',
      );
    });

    test('ignores extra query parameters rather than rejecting the link', () {
      expect(
        parseJoinDeepLink(
          Uri.parse('parimaan://join?code=K4M9PQ&utm_source=wa'),
        ),
        'K4M9PQ',
      );
    });

    test('accepts the https app-link form for the same host+path', () {
      expect(
        parseJoinDeepLink(Uri.parse('https://parimaan.app/join?code=K4M9PQ')),
        'K4M9PQ',
      );
    });
  });

  group('parseJoinDeepLink — rejects', () {
    test('a foreign scheme', () {
      expect(parseJoinDeepLink(Uri.parse('evil://join?code=K4M9PQ')), isNull);
    });

    test('a foreign https host — an attacker-controlled domain is not us', () {
      expect(
        parseJoinDeepLink(Uri.parse('https://evil.example/join?code=K4M9PQ')),
        isNull,
      );
    });

    test('a different action on our own scheme', () {
      expect(
        parseJoinDeepLink(Uri.parse('parimaan://delete?code=K4M9PQ')),
        isNull,
      );
    });

    test('a missing code parameter', () {
      expect(parseJoinDeepLink(Uri.parse('parimaan://join')), isNull);
      expect(parseJoinDeepLink(Uri.parse('parimaan://join?code=')), isNull);
    });

    test('a code that is not exactly six characters', () {
      expect(parseJoinDeepLink(Uri.parse('parimaan://join?code=ABC')), isNull);
      expect(
        parseJoinDeepLink(Uri.parse('parimaan://join?code=ABCDEFGH')),
        isNull,
      );
    });

    test(
      'a six-character code containing characters the generator never emits',
      () {
        // Unlike `validateInviteCode` — which deliberately does NOT check the
        // alphabet, because the server does not either — a deep link is
        // untrusted input arriving from outside the app. Refusing to prefill
        // from a code that cannot possibly exist costs a user nothing (they
        // can still type it) and keeps arbitrary attacker-chosen strings out
        // of the entry field.
        expect(
          parseJoinDeepLink(Uri.parse('parimaan://join?code=ABC0IL')),
          isNull,
        );
        expect(
          parseJoinDeepLink(Uri.parse('parimaan://join?code=<scr>!')),
          isNull,
        );
      },
    );
  });
}
