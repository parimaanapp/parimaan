import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../../pantry/state/search_debouncer.dart';
import '../data/catalog_repository.dart';
import '../domain/catalog_ingredient.dart';

/// A catalog-backed ingredient name field (Build B, B2c).
///
/// The caller keeps owning the name [controller] (same stateless-input rule
/// as `PInput`). While the user types, this field debounces a
/// `searchIngredients` query and lists the matches inline *below* the field —
/// inline rather than an overlay, so it works inside the recipe form's
/// reorderable list and the pantry form's scroll view without a floating
/// layer to position.
///
/// Each match shows the canonical name, its category and — when the query
/// matched an alias rather than the name — which alias ("Also known as
/// arhar"). Picking one fills the canonical name and reports it through
/// [onSelected]. The last row is always an "Add as new ingredient" fallback
/// (hidden only when the text already is a catalog name), so an unknown
/// ingredient is never blocked; it reports through [onAddAsNew].
///
/// A search failure is not an error screen: the fallback stays available
/// with a one-line note.
class IngredientPickerField extends ConsumerStatefulWidget {
  const IngredientPickerField({
    super.key,
    required this.controller,
    required this.onSelected,
    required this.onAddAsNew,
    this.fieldKey,
    this.label = 'Ingredient',
    this.hintText,
    this.errorText,
    this.enabled = true,
    this.autofocus = false,
    this.debounce = defaultDebounce,
  });

  static const Duration defaultDebounce = Duration(milliseconds: 250);

  /// The name text. Seeded text (editing an existing row) does not trigger a
  /// search until the user changes it.
  final TextEditingController controller;

  final ValueChanged<CatalogIngredient> onSelected;

  /// Called with the trimmed text when the user chooses the free-text
  /// fallback.
  final ValueChanged<String> onAddAsNew;

  /// Applied to the inner `PInput`, so existing `find.byKey` lookups of "the
  /// name field" keep resolving to the input itself.
  final Key? fieldKey;
  final String label;
  final String? hintText;
  final String? errorText;
  final bool enabled;
  final bool autofocus;
  final Duration debounce;

  static Key resultKey(String ingredientId) =>
      Key('ingredient-picker-result-$ingredientId');
  static Key aliasHintKey(String ingredientId) =>
      Key('ingredient-picker-alias-$ingredientId');
  static const Key addAsNewKey = Key('ingredient-picker-add-new');
  static const Key searchErrorKey = Key('ingredient-picker-search-error');
  static const Key searchingKey = Key('ingredient-picker-searching');

  @override
  ConsumerState<IngredientPickerField> createState() =>
      _IngredientPickerFieldState();
}

class _IngredientPickerFieldState extends ConsumerState<IngredientPickerField> {
  late final SearchDebouncer _debouncer;

  List<CatalogIngredient> _results = const <CatalogIngredient>[];
  bool _searching = false;
  bool _failed = false;

  /// The trimmed text the current [_results] answer.
  String? _resultsFor;

  /// Text the user just committed (a pick or "add as new"); the panel stays
  /// closed until the text moves away from it.
  String? _committedText;

  /// Last text seen, so selection-only controller notifications are ignored.
  late String _lastText;

  int _searchToken = 0;

  @override
  void initState() {
    super.initState();
    _lastText = widget.controller.text;
    _debouncer = SearchDebouncer(
      duration: widget.debounce,
      onSettled: (String? value) => _search(value ?? ''),
    );
    widget.controller.addListener(_onTextChanged);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    _debouncer.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    final String text = widget.controller.text;
    if (text == _lastText) {
      return;
    }
    _lastText = text;
    final String trimmed = text.trim();
    if (trimmed == _committedText) {
      _debouncer.dispose();
      return;
    }
    _committedText = null;
    if (!widget.enabled || trimmed.isEmpty) {
      _debouncer.dispose();
      _searchToken++;
      setState(() {
        _results = const <CatalogIngredient>[];
        _resultsFor = null;
        _searching = false;
        _failed = false;
      });
      return;
    }
    setState(() => _searching = true);
    _debouncer.update(trimmed);
  }

  Future<void> _search(String query) async {
    final int token = ++_searchToken;
    List<CatalogIngredient> results = const <CatalogIngredient>[];
    bool failed = false;
    try {
      results = await ref
          .read(catalogRepositoryProvider)
          .searchIngredients(query);
    } on Object {
      // A search failure must never block typing a free-text ingredient.
      failed = true;
    }
    if (!mounted || token != _searchToken) {
      return;
    }
    setState(() {
      _results = results;
      _resultsFor = query;
      _searching = false;
      _failed = failed;
    });
  }

  void _commit(String text) {
    _committedText = text;
    _debouncer.dispose();
    _searchToken++;
    setState(() {
      _results = const <CatalogIngredient>[];
      _resultsFor = null;
      _searching = false;
      _failed = false;
    });
  }

  void _pick(CatalogIngredient ingredient) {
    // Setting the controller text re-enters `_onTextChanged`; marking the
    // text committed first makes that re-entry a no-op.
    _committedText = ingredient.name;
    _lastText = ingredient.name;
    widget.controller.text = ingredient.name;
    _commit(ingredient.name);
    widget.onSelected(ingredient);
  }

  void _addAsNew() {
    final String text = widget.controller.text.trim();
    _commit(text);
    widget.onAddAsNew(text);
  }

  bool get _hasExactMatch {
    final String text = widget.controller.text.trim().toLowerCase();
    return _results.any((CatalogIngredient i) => i.name.toLowerCase() == text);
  }

  @override
  Widget build(BuildContext context) {
    final String text = widget.controller.text.trim();
    final bool answered =
        widget.enabled && text.isNotEmpty && _resultsFor == text;
    final bool searching =
        widget.enabled && text.isNotEmpty && _searching && !answered;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PInput(
          key: widget.fieldKey,
          label: widget.label,
          hintText: widget.hintText,
          controller: widget.controller,
          errorText: widget.errorText,
          enabled: widget.enabled,
          autofocus: widget.autofocus,
        ),
        if (searching)
          Padding(
            key: IngredientPickerField.searchingKey,
            padding: const EdgeInsets.only(top: AppSpacing.s1),
            child: Text(
              'Searching the catalog…',
              style: AppTypography.label.copyWith(color: AppColors.inkMid),
            ),
          ),
        if (answered) ...<Widget>[
          if (_failed)
            Padding(
              key: IngredientPickerField.searchErrorKey,
              padding: const EdgeInsets.only(top: AppSpacing.s1),
              child: Text(
                'Could not search the catalog — you can still add it as a '
                'new ingredient.',
                style: AppTypography.label.copyWith(color: AppColors.inkMid),
              ),
            ),
          for (final CatalogIngredient ingredient in _results)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.s1),
              child: PickerResultRow(
                key: IngredientPickerField.resultKey(ingredient.id),
                ingredient: ingredient,
                query: text,
                onTap: () => _pick(ingredient),
              ),
            ),
          if (!_hasExactMatch)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.s1),
              child: PCard(
                key: IngredientPickerField.addAsNewKey,
                onTap: _addAsNew,
                semanticLabel: 'Add $text as new ingredient',
                child: Text.rich(
                  TextSpan(
                    children: <InlineSpan>[
                      TextSpan(
                        text: 'Add ',
                        style: AppTypography.body.copyWith(
                          color: AppColors.inkSoft,
                        ),
                      ),
                      TextSpan(
                        text: '“$text”',
                        style: AppTypography.bodyStrong.copyWith(
                          color: AppColors.ink,
                        ),
                      ),
                      TextSpan(
                        text: ' as new ingredient',
                        style: AppTypography.body.copyWith(
                          color: AppColors.inkSoft,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

/// One catalog match: canonical name, category badge and, when the query
/// matched an alias, an "Also known as" hint. Everything wraps — nothing is
/// truncated at 320pt or 2x text scale.
class PickerResultRow extends StatelessWidget {
  const PickerResultRow({
    super.key,
    required this.ingredient,
    required this.query,
    required this.onTap,
  });

  final CatalogIngredient ingredient;
  final String query;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String? alias = matchedAlias(ingredient, query);
    return PCard(
      onTap: onTap,
      semanticLabel: '${ingredient.name}, ${ingredient.categoryLabel}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            ingredient.name,
            style: AppTypography.bodyStrong.copyWith(color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.s0),
          Wrap(
            spacing: AppSpacing.s1,
            runSpacing: AppSpacing.s0,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              PBadge(label: ingredient.categoryLabel, uppercase: false),
              if (alias != null)
                Text(
                  'Also known as $alias',
                  key: IngredientPickerField.aliasHintKey(ingredient.id),
                  style: AppTypography.label.copyWith(color: AppColors.inkMid),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
