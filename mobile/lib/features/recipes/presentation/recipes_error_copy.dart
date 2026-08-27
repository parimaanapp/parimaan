import '../../../shared/errors/app_error.dart';

/// Turns an `AppError` from the recipe Detail/Overflow flows into
/// user-facing copy — same shape as `features/pantry/presentation/pantry_error_copy.dart`:
/// an exhaustive `switch` so the compiler flags this file when `AppError`
/// grows a variant, and the server's own message passed through wherever it
/// is the better sentence.
String? recipeErrorMessage(Object? error) => switch (error) {
  null => null,
  UnauthorizedError() => 'Your session has expired. Sign in again.',
  ForbiddenError(:final String errorMessage) => errorMessage,
  ValidationError(:final String errorMessage) => errorMessage,
  ConflictError(:final String errorMessage) => errorMessage,
  // The identical message a nonexistent id and a recipe in another
  // household both produce — see `shared/schema.graphql`'s doc on
  // `Mutation.updateRecipe`/`deleteRecipe`/`favoriteRecipe`/
  // `setInRotation`. Passed through as-is, not re-worded.
  NotFoundError(:final String errorMessage) => errorMessage,
  HouseholdFullError(:final String errorMessage) => errorMessage,
  RateLimitedError(:final String errorMessage) => errorMessage,
  InternalError(:final String errorMessage) => errorMessage,
  // Not an `AppError`. `RecipeRepository`'s contract says this cannot
  // happen; rendering a Dart exception's `toString` would be worse than the
  // server's own generic sentence.
  _ => genericErrorMessage,
};
