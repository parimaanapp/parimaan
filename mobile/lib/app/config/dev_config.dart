import 'app_config.dart';

/// The `dev` environment's build-time config.
///
/// **Every value below is a placeholder and the app cannot authenticate until
/// they are replaced.** They are filled in by hand, per environment, from the
/// `AuthStack` CloudFormation outputs — see **`docs/RUNBOOK.md` §2, "Mobile
/// build-time config — CfnOutputs and the manual transcription step"** for the
/// exact procedure. In short:
///
/// ```
/// cd infra && pnpm cdk deploy Parimaan-dev-Auth \
///   -c env=dev -c googleClientId=<id>.apps.googleusercontent.com
/// ```
///
/// then copy `UserPoolId`, `MobileClientId`, `CognitoDomain` and `Region` out
/// of the `Outputs` block the CLI prints.
///
/// `graphQlUrl` comes from a **second** stack — `Parimaan-dev-Api`'s
/// `GraphQlUrl` output — so the transcription step has two deploys to read
/// from, not one. It is listed in `placeholderFields` alongside the four
/// Cognito values, which means `AmplifyAuthRepository` refuses to configure
/// until the API endpoint is filled in too. That is deliberate: an app that
/// can sign in but cannot reach the API is a worse failure than one that
/// says up front which value is missing.
///
/// Re-run the transcription whenever the user pool or app client is *replaced*
/// rather than updated (Cognito's `Schema` is immutable post-creation, so an
/// attribute change replaces the pool and changes the pool id). A stale value
/// here fails at sign-in with an opaque Cognito error, which is exactly why
/// `AppConfig.placeholderFields` exists and why `AmplifyAuthRepository` refuses
/// to configure against a placeholder rather than letting Cognito reject it.
///
/// A `prodConfig` belongs beside this one when the prod stack is first
/// deployed; there is deliberately no `prod` placeholder yet, because an
/// unfilled prod config is worse than an absent one.
const AppConfig devConfig = AppConfig(
  userPoolId: 'REPLACE_ME_USER_POOL_ID',
  mobileClientId: 'REPLACE_ME_MOBILE_CLIENT_ID',
  cognitoDomain: 'REPLACE_ME_COGNITO_DOMAIN',
  region: 'REPLACE_ME_REGION',
  graphQlUrl: 'REPLACE_ME_GRAPHQL_URL',
);
