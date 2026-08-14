import * as cdk from 'aws-cdk-lib';
import {
  OAuthScope,
  ProviderAttribute,
  UserPool,
  UserPoolClientIdentityProvider,
  UserPoolIdentityProviderGoogle,
} from 'aws-cdk-lib/aws-cognito';
import type { UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

// Every flag explicitly `false` — NOT an empty object, NOT omitted. Verified
// empirically: omitting `authFlows` lets AWS default to ALLOW_USER_SRP_AUTH
// (native username/password), and an empty object is treated identically to
// omitted. Only an object with every flag explicitly false produces
// ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"] — no interactive auth path,
// which is what "Google IdP only, no password path" actually requires.
const GOOGLE_ONLY_AUTH_FLOWS = {
  userSrp: false,
  userPassword: false,
  adminUserPassword: false,
  custom: false,
};

const OAUTH_SCOPES = [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE];

export interface AuthStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
  /**
   * Google OAuth Client ID. Not sensitive — client IDs are meant to be
   * public (they ship in mobile binaries and appear in browser network
   * requests) — so this is a plain prop, not a Secrets Manager reference.
   * The Client *Secret* is sourced from Secrets Manager below and never
   * appears as a literal anywhere in this stack.
   */
  readonly googleClientId: string;
}

/**
 * Cognito user pool + Google identity provider — the only sign-in path
 * for Parimaan (locked decision: Google IdP only, no username/password).
 *
 * Two app clients: a public mobile client (PKCE, no client secret — driven
 * by `amplify_auth_cognito` per E2E_MVP_PLAN.md §10 Q2) and a confidential
 * web client (generated secret, used by the Next.js dashboard's NextAuth
 * integration).
 *
 * See SYSTEM_DESIGN.md §7.4 for the full design rationale.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: UserPool;
  public readonly mobileClient: UserPoolClient;
  public readonly webClient: UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { envName, googleClientId } = props;
    const webDomain = envName === 'prod' ? 'parimaan.app' : 'dev.parimaan.app';

    this.userPool = new UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
        // Cognito Schema is immutable post-creation (CFN can only replace,
        // never update, the pool) — adding this later once real users exist
        // would mean a destructive pool replacement. Cheap to include now.
        profilePicture: { required: false, mutable: true },
      },
    });

    const googleIdp = new UserPoolIdentityProviderGoogle(this, 'GoogleIdp', {
      userPool: this.userPool,
      clientId: googleClientId,
      clientSecretValue: cdk.SecretValue.secretsManager('parimaan/google-oauth-secret'),
      scopes: ['profile', 'email', 'openid'],
      attributeMapping: {
        email: ProviderAttribute.GOOGLE_EMAIL,
        fullname: ProviderAttribute.GOOGLE_NAME,
        profilePicture: ProviderAttribute.GOOGLE_PICTURE,
      },
    });

    this.mobileClient = this.addGoogleOnlyClient('MobileClient', googleIdp, {
      generateSecret: false,
      callbackUrls: ['parimaan://auth'],
      logoutUrls: ['parimaan://logout'],
    });

    this.webClient = this.addGoogleOnlyClient('WebClient', googleIdp, {
      generateSecret: true,
      callbackUrls: [`https://${webDomain}/api/auth/callback/cognito`],
      logoutUrls: [`https://${webDomain}`],
    });

    this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `parimaan-${envName}` },
    });
  }

  /**
   * Adds a user pool client restricted to Google sign-in only, with the
   * common OAuth/token config every Parimaan client shares. `googleIdp` must
   * be passed explicitly and depended on — CDK does not automatically order
   * app clients after the identity provider they support, and creating a
   * client before its IdP exists fails at CloudFormation deploy time.
   */
  private addGoogleOnlyClient(
    id: string,
    googleIdp: UserPoolIdentityProviderGoogle,
    opts: { generateSecret: boolean; callbackUrls: string[]; logoutUrls: string[] },
  ): UserPoolClient {
    const client = this.userPool.addClient(id, {
      generateSecret: opts.generateSecret,
      // Explicit props below are the real fix for a verified security gap:
      // omitting either lets CDK/AWS default to allowing native Cognito
      // username/password auth alongside Google, silently contradicting
      // the "Google IdP only" design.
      supportedIdentityProviders: [UserPoolClientIdentityProvider.GOOGLE],
      authFlows: GOOGLE_ONLY_AUTH_FLOWS,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: OAUTH_SCOPES,
        callbackUrls: opts.callbackUrls,
        logoutUrls: opts.logoutUrls,
      },
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    client.node.addDependency(googleIdp);
    return client;
  }
}
