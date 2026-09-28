import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// `lib/shared/graphql/schema.graphql` is a hand-made COPY of the repo-root
/// `shared/schema.graphql` (its own header explains why), and it warned that
/// it "can silently drift from the source" with no automated check. A stale
/// copy fails in the worst way: `ferry_generator` happily generates types from
/// the OLD schema, the app compiles, and a new field or mutation simply does
/// not exist on the client. This closes that gap: CI fails the moment the two
/// differ below the copy's header.
///
/// Skipped (not failed) when run from a checkout without the sibling
/// `../shared/` directory, since `mobile/` is deliberately outside the pnpm
/// workspace (Q13) and could in principle be built standalone.
void main() {
  test('the mobile schema copy matches shared/schema.graphql below its header', () {
    final File shared = File('../shared/schema.graphql');
    if (!shared.existsSync()) {
      markTestSkipped('shared/schema.graphql not found relative to mobile/');
      return;
    }
    final String copy = File('lib/shared/graphql/schema.graphql').readAsStringSync();
    const String marker = '# Parimaan GraphQL schema — SINGLE SOURCE OF TRUTH.';
    final int at = copy.indexOf(marker);

    expect(at, greaterThanOrEqualTo(0), reason: 'the copy lost the marker line its header is split on');
    expect(
      copy.substring(at),
      shared.readAsStringSync(),
      reason:
          'The mobile schema copy has drifted. Fix: re-copy shared/schema.graphql below '
          "the copy's header, then `dart run build_runner build`.",
    );
  });
}
