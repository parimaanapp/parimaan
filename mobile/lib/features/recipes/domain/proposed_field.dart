import 'package:collection/collection.dart';

/// A single value that may be a still-unconfirmed proposal, a
/// user-confirmed value (accepted as-is), a user-edited value, or simply
/// absent — the generic domain primitive behind the `AIProposal` widget
/// and any future consumer of "a proposed value the user accepts, edits,
/// or rejects" (E2E_MVP_PLAN.md §13.2.17: the fifth WS-5 domain widget,
/// built generic on purpose since W18's photo-pantry review and W19's
/// cook-from-pantry review are its second and third consumers, not just
/// this week's recipe-draft review).
///
/// Deliberately NOT recipe-shaped — `T` is whatever the caller is
/// proposing (a `String` title, a `RecipeRole`, a `List<String>` of
/// dietary tags, ...). This class owns only the three-state transition
/// logic; rendering (proposed vs. confirmed styling, truncation, warnings)
/// is the `AIProposal` widget's job, and recipe-specific field wiring is
/// `AiRecipeDraftController`'s.
class ProposedField<T> {
  /// An unconfirmed proposal — [isProposed] is only actually meaningful
  /// when [value] is non-null; see [hasProposal].
  const ProposedField.proposed(T? value)
    : this._(value, isProposed: true, isUserModified: false);

  /// A value the user has explicitly accepted as-is (or the resting state
  /// for a field that was never a proposal in the first place — e.g. one
  /// the model/page didn't populate).
  const ProposedField.confirmed(T? value)
    : this._(value, isProposed: false, isUserModified: false);

  /// A value the user has typed/selected themselves, overriding whatever
  /// (if anything) was proposed — the ≤3-edits metric's data source
  /// (§13.5.7): this is the state that counts as an "edit".
  const ProposedField.userModified(T value)
    : this._(value, isProposed: false, isUserModified: true);

  /// No value at all — the result of [reject], or the starting state for
  /// a field the draft never populated.
  const ProposedField.empty() : this._(null, isProposed: false, isUserModified: false);

  const ProposedField._(
    this.value, {
    required this.isProposed,
    required this.isUserModified,
  });

  final T? value;
  final bool isProposed;
  final bool isUserModified;

  /// Whether this field should actually render/behave as a live proposal.
  /// A [ProposedField.proposed] constructed with a `null` value (the
  /// model/page didn't populate this field) has nothing to accept or
  /// reject — it renders as an ordinary empty field, not a proposal
  /// (E2E_MVP_PLAN.md §13.3 S7's own named RED test).
  bool get hasProposal => isProposed && value != null;

  /// Accepts the current (proposed) value as-is.
  ProposedField<T> accept() => ProposedField<T>.confirmed(value);

  /// Replaces the value with one the user typed/selected — always marks
  /// the result [isUserModified], whether or not a proposal existed.
  ProposedField<T> edit(T newValue) => ProposedField<T>.userModified(newValue);

  /// Discards the value entirely.
  ProposedField<T> reject() => ProposedField<T>.empty();

  /// The identical proposed/confirmed/user-modified status, with
  /// [newValue] substituted for [value] — used by `AIProposal` to hand its
  /// builder a truncated display copy of an absurdly long value without
  /// losing the field's own status in the process.
  ProposedField<T> withValue(T? newValue) =>
      ProposedField<T>._(
        newValue,
        isProposed: isProposed,
        isUserModified: isUserModified,
      );

  /// `T` is sometimes list-shaped (`dietaryTags`/`ingredients`/`steps` on
  /// `AiRecipeDraftState`) — Dart's default `List` equality is identity,
  /// not content, so plain `==`/`hashCode` on [value] would treat two
  /// content-identical-but-distinct list instances as unequal. Routing
  /// through [DeepCollectionEquality] makes [value] comparisons/hashes
  /// content-based for lists (and any nested collections) while staying a
  /// no-op passthrough for every other `T`.
  static const DeepCollectionEquality _valueEquality = DeepCollectionEquality();

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ProposedField<T> &&
          _valueEquality.equals(other.value, value) &&
          other.isProposed == isProposed &&
          other.isUserModified == isUserModified;

  @override
  int get hashCode =>
      Object.hash(_valueEquality.hash(value), isProposed, isUserModified);
}
