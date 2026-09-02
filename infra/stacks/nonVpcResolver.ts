import * as cdk from 'aws-cdk-lib';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

export interface NonVpcResolverProps {
  /** Full path to the resolver's entry file, matching `createDbResolverFunction`'s own `join(__dirname, ...)` convention at the call site. */
  readonly entry: string;
  readonly environment?: Record<string, string>;
}

/**
 * One non-VPC resolver Lambda — the second Lambda category this stack
 * builds, alongside `createDbResolverFunction`'s VPC-attached one
 * (`E2E_MVP_PLAN.md` §13.2.1, D3). Extracted as a standalone function
 * (not a private `ApiStack` method, unlike `createDbResolverFunction`) so
 * it is directly unit-testable against a throwaway stack — no production
 * `AI_RESOLVERS`/`NET_RESOLVERS` entry exists yet as of S2 (S3/S5 add the
 * first ones), so there is nothing in `ApiStack`'s own synthesized template
 * to assert this shape against otherwise.
 *
 * Deliberately no `vpc`/`vpcSubnets`/`securityGroups` — D3's whole point:
 * this Lambda has no route to Aurora and doesn't need one (it can't run
 * `requireHouseholdMember`, so callers of resolvers built on this must not
 * accept a `householdId` they can't authorize). It reaches Secrets
 * Manager, DynamoDB, and any public HTTPS endpoint (Gemini, a recipe blog)
 * over the public, IAM-signed/internet path — the same path any Lambda
 * outside a VPC always uses, not a new networking arrangement.
 *
 * No `appRoleSecret` grant, ever — this Lambda has no Aurora connection to
 * authenticate, so granting it read access to that secret would be a real
 * permission with no corresponding use, exactly the kind of unused-grant
 * `security-reviewer` flags.
 */
export const createNonVpcResolverFunction = (scope: Construct, id: string, props: NonVpcResolverProps): NodejsFunction =>
  new NodejsFunction(scope, id, {
    entry: props.entry,
    runtime: Runtime.NODEJS_24_X,
    handler: 'handler',
    // AppSync's own resolver-invocation ceiling is 30s regardless of this
    // value (§13.2.8) — 28s leaves a couple of seconds of Lambda-init
    // headroom below that hard ceiling while still comfortably covering
    // `AI_DEADLINE_MS` (15s, §13.2.7) or `importRecipeFromUrl`'s 8s
    // outbound-fetch sub-budget (§13.2.8), whichever resolver this is.
    timeout: cdk.Duration.seconds(28),
    memorySize: 512,
    tracing: Tracing.ACTIVE,
    environment: props.environment ?? {},
    // See `data-stack.ts`'s identical `esbuildArgs` comment — trims
    // esbuild's own CLI logging, a documented aggravating factor in a
    // CI-only Vitest worker-IPC-heartbeat flake, for every Lambda built
    // through this factory.
    bundling: { esbuildArgs: { '--log-level': 'error' } },
  });
