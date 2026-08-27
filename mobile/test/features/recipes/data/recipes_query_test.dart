import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'the Recipes query does not select ingredients — Library scale, not Detail scale',
    () {
      final String source = File(
        'lib/shared/graphql/operations/recipes.graphql',
      ).readAsStringSync();

      // The file's leading `#` doc comment names `ingredients` on purpose,
      // to explain the omission — only the selection set (everything from
      // the `query Recipes(...)` line on) must actually be free of it.
      final int queryStart = source.indexOf('query Recipes');
      final String selectionSet = source.substring(queryStart);

      expect(selectionSet, isNot(contains('ingredients')));
    },
  );
}
