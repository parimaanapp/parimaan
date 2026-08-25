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
  userPoolId: 'ap-south-1_86KBFEDF9',
  mobileClientId: '5uo71gs1auratk3ik3qghome48',
  cognitoDomain: 'https://parimaan-dev.auth.ap-south-1.amazoncognito.com',
  region: 'ap-south-1',
  graphQlUrl: 'https://vtcratz73bcb7dryrnktaaiupe.appsync-api.ap-south-1.amazonaws.com/graphql',
);
