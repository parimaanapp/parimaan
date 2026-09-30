/// The vibe chips on wireframe 11.1 (W21). A closed set that mirrors the
/// server's `CookVibe` enum: there is no free-text vibe, so nothing a user
/// types can reach the model's prompt through it.
enum CookVibe {
  quick('Quick'),
  weekend('Weekend'),
  kidFriendly('Kid-friendly'),
  comfort('Comfort');

  const CookVibe(this.label);

  /// The chip's text, as drawn in the wireframe.
  final String label;
}
