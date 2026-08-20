/// Build-time configuration for one deployment environment.
///
/// Deliberately dumb: four `String`s and no behaviour beyond validation. It
/// reads nothing — not `String.fromEnvironment`, not `Platform.environment`,
/// not a file. Choosing *which* config the app runs with is the job of the
/// composition root (`main.dart`), and the concrete instances live next door
/// (`dev_config.dart`).
///
/// None of these four values is a secret. The mobile Cognito app client is a
/// public PKCE client (`generateSecret: false` in `infra/stacks/auth-stack.ts`),
/// so the pool id, client id and hosted-UI domain ship inside every binary
/// regardless — see the CfnOutput doc comment in that stack.
class AppConfig {
  const AppConfig({
    required this.userPoolId,
    required this.mobileClientId,
    required this.cognitoDomain,
    required this.region,
  });

  /// Cognito User Pool ID, e.g. `ap-south-1_xxxxxxxxx`.
  /// From the `UserPoolId` CfnOutput of `AuthStack`.
  final String userPoolId;

  /// The **public** (PKCE, secretless) app client id.
  /// From the `MobileClientId` CfnOutput. Never the confidential web client.
  final String mobileClientId;

  /// Hosted UI base URL, e.g. `https://parimaan-dev.auth.ap-south-1.amazoncognito.com`.
  /// From the `CognitoDomain` CfnOutput.
  final String cognitoDomain;

  /// AWS region the environment is deployed to. From the `Region` CfnOutput.
  final String region;

  /// The Hosted UI domain with any URL scheme stripped.
  ///
  /// Amplify's Cognito config wants a bare host (`parimaan-dev.auth.…`) while
  /// the CfnOutput is a full URL, so the conversion belongs here rather than
  /// being repeated at every call site.
  String get cognitoWebDomain =>
      cognitoDomain.replaceFirst(RegExp('^https?://'), '');

  /// Every field that is still an un-transcribed placeholder.
  ///
  /// Empty means the config is at least *shaped* like real values. It is not a
  /// guarantee they are correct — only a deploy can tell you that — but it
  /// turns the most common failure (nobody ran the RUNBOOK transcription step)
  /// into a named error instead of an opaque Cognito rejection at sign-in.
  List<String> get placeholderFields => <String>[
    if (_isPlaceholder(userPoolId)) 'userPoolId',
    if (_isPlaceholder(mobileClientId)) 'mobileClientId',
    if (_isPlaceholder(cognitoDomain)) 'cognitoDomain',
    if (_isPlaceholder(region)) 'region',
  ];

  bool get isPlaceholder => placeholderFields.isNotEmpty;

  static bool _isPlaceholder(String value) =>
      value.trim().isEmpty || value.startsWith(placeholderPrefix);

  /// Marker prefix every unfilled value in `dev_config.dart` carries.
  static const String placeholderPrefix = 'REPLACE_ME_';

  @override
  String toString() =>
      'AppConfig(region: $region, userPoolId: $userPoolId, '
      'mobileClientId: $mobileClientId, cognitoDomain: $cognitoDomain)';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppConfig &&
          other.userPoolId == userPoolId &&
          other.mobileClientId == mobileClientId &&
          other.cognitoDomain == cognitoDomain &&
          other.region == region;

  @override
  int get hashCode =>
      Object.hash(userPoolId, mobileClientId, cognitoDomain, region);
}
