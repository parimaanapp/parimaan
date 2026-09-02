import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import {
  AuthorizationType,
  Definition,
  FieldLogLevel,
  GraphqlApi,
} from 'aws-cdk-lib/aws-appsync';
import type { IUserPool, UserPool } from 'aws-cdk-lib/aws-cognito';
import type { ISecurityGroup, IVpc, Vpc } from 'aws-cdk-lib/aws-ec2';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds';
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Secret as SecretsManagerSecret } from 'aws-cdk-lib/aws-secretsmanager';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import { createNonVpcResolverFunction } from './nonVpcResolver';

export interface ApiStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
  /**
   * User pool from AuthStack — ApiStack does not create its own.
   * Typed as the concrete `UserPool` class (matching `AuthStack.userPool`'s
   * type), not `IUserPool` — same `exactOptionalPropertyTypes` friction as
   * `NetworkStack.vpc` → `DataStack`, same narrow documented-cast fix below.
   */
  readonly userPool: UserPool;
  /** VPC from NetworkStack — every database-backed resolver Lambda needs it to reach Aurora. */
  readonly vpc: Vpc;
  /** Aurora cluster from DataStack — only its endpoint (host/port) is used; credentials come from `appRoleSecret`, not the cluster's own admin secret. */
  readonly dbCluster: DatabaseCluster;
  /**
   * Login-password secret for the least-privileged `parimaan_app` Postgres
   * role, from DataStack. Typed as the concrete `Secret` class (matching
   * `DataStack.appRoleSecret`'s type), not `ISecret` — same
   * `exactOptionalPropertyTypes` friction as `vpc`/`userPool` above.
   */
  readonly appRoleSecret: Secret;
  /** Shared security group for VPC-attached Lambdas reaching Aurora, from DataStack. */
  readonly lambdaSecurityGroup: ISecurityGroup;
  /**
   * DynamoDB cache/rate-limit table from DataStack. Four rate-limited
   * mutations use it (per-caller daily counters — see
   * `api/src/rateLimit/dailyActionLimiter.ts`): `joinHousehold`, guarding
   * the invite code's ~887M-code keyspace against a scripted guesser;
   * `rotateInviteCode`, whose abuse shape is a member denying every
   * co-member access; and the two non-VPC AI/import resolvers,
   * `parseFreeformRecipe` (`'freeformParse'`) and `importRecipeFromUrl`
   * (`'urlImport'`), both added in W7. Granted to exactly those four
   * Lambdas (via `needsCacheTable` on `DbResolverEntry` below and its
   * identical counterpart on `NonVpcResolverEntry`), never to the other
   * resolvers. Re-confirmed complete as of the W8 S11 phase-boundary
   * security sweep (E2E_MVP_PLAN.md §14.5.9) — this comment had drifted
   * stale (still said "the two") since the non-VPC pair was added.
   */
  readonly cacheTable: Table;
}

/**
 * One VPC-attached, database-backed resolver Lambda and the single GraphQL
 * field it resolves. `id` doubles as the construct-id stem for all three
 * synthesized resources (`<id>Fn`, `<id>DataSource`, `<id>Resolver`), so it
 * is effectively a CloudFormation logical id — renaming one replaces the
 * Lambda rather than updating it.
 */
interface DbResolverEntry {
  readonly id: string;
  readonly entryFile: string;
  readonly typeName: string;
  readonly fieldName: string;
  /**
   * Grants `CACHE_TABLE_NAME` + a narrow `dynamodb:UpdateItem` on the shared
   * cache table. True ONLY for the rate-limited mutations — `joinHousehold`
   * (guessable invite-code keyspace) and `rotateInviteCode` (destructive for
   * co-members). Every other resolver must have no DynamoDB access at all.
   */
  readonly needsCacheTable?: boolean;
}

/**
 * The full set of database-backed resolvers, declared once and wired by a
 * single loop below — the per-Lambda `createDbResolverFunction` +
 * `wireResolver` + grant sequence is identical for every entry, so keeping it
 * as data rather than repeated statements is what makes adding a resolver a
 * one-line change (and keeps the wiring method under the 50-line
 * `max-lines-per-function` ceiling).
 */
const DB_RESOLVERS: readonly DbResolverEntry[] = [
  { id: 'Me', entryFile: 'me.ts', typeName: 'Query', fieldName: 'me' },
  {
    id: 'CreateHousehold',
    entryFile: 'createHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'createHousehold',
  },
  {
    id: 'UserHouseholds',
    entryFile: 'userHouseholds.ts',
    typeName: 'User',
    fieldName: 'households',
  },
  {
    id: 'JoinHousehold',
    entryFile: 'joinHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'joinHousehold',
    needsCacheTable: true,
  },
  {
    id: 'UpdateHouseholdSettings',
    entryFile: 'updateHouseholdSettings.ts',
    typeName: 'Mutation',
    fieldName: 'updateHouseholdSettings',
  },
  {
    id: 'RotateInviteCode',
    entryFile: 'rotateInviteCode.ts',
    typeName: 'Mutation',
    fieldName: 'rotateInviteCode',
    needsCacheTable: true,
  },
  {
    id: 'LeaveHousehold',
    entryFile: 'leaveHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'leaveHousehold',
  },
  {
    id: 'DeleteHousehold',
    entryFile: 'deleteHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'deleteHousehold',
  },
  {
    id: 'Household',
    entryFile: 'household.ts',
    typeName: 'Query',
    fieldName: 'household',
  },
  {
    id: 'Pantry',
    entryFile: 'pantry.ts',
    typeName: 'Query',
    fieldName: 'pantry',
  },
  {
    id: 'AddPantryItem',
    entryFile: 'addPantryItem.ts',
    typeName: 'Mutation',
    fieldName: 'addPantryItem',
  },
  {
    id: 'UpdatePantryItem',
    entryFile: 'updatePantryItem.ts',
    typeName: 'Mutation',
    fieldName: 'updatePantryItem',
  },
  {
    id: 'DeletePantryItem',
    entryFile: 'deletePantryItem.ts',
    typeName: 'Mutation',
    fieldName: 'deletePantryItem',
  },
  {
    id: 'BulkAddPantryItems',
    entryFile: 'bulkAddPantryItems.ts',
    typeName: 'Mutation',
    fieldName: 'bulkAddPantryItems',
  },
  {
    id: 'OnPantryChanged',
    entryFile: 'onPantryChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onPantryChanged',
  },
  {
    id: 'Recipes',
    entryFile: 'recipes.ts',
    typeName: 'Query',
    fieldName: 'recipes',
  },
  {
    id: 'Recipe',
    entryFile: 'recipe.ts',
    typeName: 'Query',
    fieldName: 'recipe',
  },
  {
    id: 'RecipeIngredients',
    entryFile: 'recipeIngredients.ts',
    typeName: 'Recipe',
    fieldName: 'ingredients',
  },
  {
    id: 'CreateRecipe',
    entryFile: 'createRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'createRecipe',
  },
  {
    id: 'UpdateRecipe',
    entryFile: 'updateRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'updateRecipe',
  },
  {
    id: 'DeleteRecipe',
    entryFile: 'deleteRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'deleteRecipe',
  },
  {
    id: 'FavoriteRecipe',
    entryFile: 'favoriteRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'favoriteRecipe',
  },
  {
    id: 'SetInRotation',
    entryFile: 'setInRotation.ts',
    typeName: 'Mutation',
    fieldName: 'setInRotation',
  },
  {
    id: 'OnRecipeChanged',
    entryFile: 'onRecipeChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onRecipeChanged',
  },
  {
    id: 'OnHouseholdChanged',
    entryFile: 'onHouseholdChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onHouseholdChanged',
  },
  {
    id: 'NotificationPreferences',
    entryFile: 'notificationPreferences.ts',
    typeName: 'Query',
    fieldName: 'notificationPreferences',
  },
  {
    id: 'UpdateNotificationPreferences',
    entryFile: 'updateNotificationPreferences.ts',
    typeName: 'Mutation',
    fieldName: 'updateNotificationPreferences',
  },
  {
    id: 'Menu',
    entryFile: 'menu.ts',
    typeName: 'Query',
    fieldName: 'menu',
  },
  {
    id: 'CreateMenu',
    entryFile: 'createMenu.ts',
    typeName: 'Mutation',
    fieldName: 'createMenu',
  },
  {
    id: 'AddMenuItem',
    entryFile: 'addMenuItem.ts',
    typeName: 'Mutation',
    fieldName: 'addMenuItem',
  },
  {
    id: 'RemoveMenuItem',
    entryFile: 'removeMenuItem.ts',
    typeName: 'Mutation',
    fieldName: 'removeMenuItem',
  },
];

/**
 * One non-VPC resolver Lambda and the single GraphQL field it resolves —
 * the `DbResolverEntry`/`DB_RESOLVERS` shape, adapted for the second Lambda
 * category this stack builds (`E2E_MVP_PLAN.md` §13.2.1, D3).
 */
interface NonVpcResolverEntry {
  readonly id: string;
  readonly entryFile: string;
  readonly typeName: string;
  readonly fieldName: string;
  /** Grants `GEMINI_API_KEY_SECRET_ARN` + a narrow `secretsmanager:GetSecretValue` scoped to that one secret's ARN. True only for resolvers that actually call Gemini — `importRecipeFromUrl` (S5) never sets this. */
  readonly needsGeminiSecret?: boolean;
  /** Grants `CACHE_TABLE_NAME` + a narrow `dynamodb:UpdateItem` on the shared cache table — same flag, same narrow grant shape as `DbResolverEntry.needsCacheTable` above, reused here rather than re-invented for this category. True for `parseFreeformRecipe` (S3, `'freeformParse'` rate limit) and, later, `importRecipeFromUrl` (S5, `'urlImport'`). */
  readonly needsCacheTable?: boolean;
}

/**
 * The AI-calling non-VPC resolvers. `parseFreeformRecipe` (S3) is the
 * first real entry — `AI_RESOLVERS` stayed empty through S2 only because
 * AppSync's `createResolver` requires the field to already exist in the
 * deployed SDL, which S3 is what adds.
 */
const AI_RESOLVERS: readonly NonVpcResolverEntry[] = [
  {
    id: 'ParseFreeformRecipe',
    entryFile: 'parseFreeformRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'parseFreeformRecipe',
    needsGeminiSecret: true,
    needsCacheTable: true,
  },
];

/**
 * The non-AI, non-VPC resolvers. `importRecipeFromUrl` (S5) never calls
 * Gemini — no `needsGeminiSecret` — but shares the identical non-VPC/
 * no-Aurora-route rationale as `AI_RESOLVERS` (§13.2.1 D3) and needs the
 * cache table for its own `'urlImport'` rate limit (§13.2.9 D8).
 */
const NET_RESOLVERS: readonly NonVpcResolverEntry[] = [
  {
    id: 'ImportRecipeFromUrl',
    entryFile: 'importRecipeFromUrl.ts',
    typeName: 'Mutation',
    fieldName: 'importRecipeFromUrl',
    needsCacheTable: true,
  },
];

/**
 * AppSync GraphQL API, Cognito-authorized. Resolvers:
 * - `Query._health` — W1 placeholder, proves the AppSync → Lambda →
 *   response pipeline end-to-end (SYSTEM_DESIGN.md §6.1-§6.3).
 * - `Query.me`, `Mutation.createHousehold`, `User.households` — the first
 *   real slice (SYSTEM_DESIGN.md §5.1-§5.2), landing W3/W4 per
 *   E2E_MVP_PLAN.md §4. `User.households` is its own field resolver
 *   (rather than `me` returning a hydrated tree) specifically to avoid the
 *   User↔HouseholdMembership↔User schema cycle failing on a non-null field
 *   at arbitrary query depth.
 * - `Mutation.joinHousehold`, `Mutation.updateHouseholdSettings` — the rest
 *   of the W4 milestone. `joinHousehold` deliberately has no
 *   `requireHouseholdMember` gate (the caller isn't a member yet — that's
 *   the point) and is rate-limited via DynamoDB (`cacheTable`) against its
 *   guessable invite-code keyspace; `updateHouseholdSettings` is the first
 *   resolver in this codebase gated by `requireHouseholdMember` (SD §6.2
 *   layer 2), with RLS on `household_settings` as layer-3 defense-in-depth
 *   behind it.
 * - `Mutation.rotateInviteCode`, `Mutation.leaveHousehold`,
 *   `Mutation.deleteHousehold` — household lifecycle. `rotateInviteCode` is
 *   member-gated and rate-limited (the second consumer of `cacheTable`);
 *   `leaveHousehold` is deliberately NOT `requireHouseholdMember`-gated,
 *   because "not a member" is its success state, not a denial;
 *   `deleteHousehold` is primary-only behind an exact-name confirmation and
 *   is the only path by which a household is ever destroyed.
 * - `Query.household` — a member-gated, read-only hydration of a single
 *   household's settings and full member list. Exists because
 *   `me { households { household { members } } }` deliberately returns each
 *   membership's household with an empty `members` list (a recursion
 *   cutoff, not a bug) — the Members list screen and any poll-based refresh
 *   (in lieu of the subscriptions below) need this instead. No rate
 *   limiting: it's a plain authorized read, not a guessable-keyspace or
 *   destructive-to-others action like the two `cacheTable` consumers above.
 * - `Query.pantry`, `Mutation.addPantryItem` — W5 slice S2
 *   (E2E_MVP_PLAN.md §11.3). Both member-gated the same way as
 *   `Query.household`/`updateHouseholdSettings`, with `pantry_items`'
 *   `FOR ALL USING (...) WITH CHECK (...)` RLS policy (S1) as layer-3
 *   defense-in-depth behind them.
 * - `Mutation.updatePantryItem`, `Mutation.deletePantryItem`,
 *   `Mutation.bulkAddPantryItems` — W5 slice S3. The first two take only
 *   `id` (no `householdId`), so unlike every resolver above there is no
 *   `requireHouseholdMember` pre-check possible — RLS alone gates them,
 *   and a nonexistent id or one in another household both surface as the
 *   identical `NOT_FOUND` (see `resolvers/updatePantryItem.ts`'s doc).
 *   `bulkAddPantryItems` IS `householdId`-gated like `addPantryItem`, and
 *   is capped at 50 items per call.
 * - `Subscription.onPantryChanged` — W5 slice S8, the first subscription in
 *   the app. Authorization is a Lambda resolver on this field, invoked once
 *   at subscribe time — a deliberate deviation from SD §10.4's stated
 *   API-level `AWS_LAMBDA` authorizer (E2E_MVP_PLAN.md §11.2.9): adopting
 *   that literally would add a second auth mode to a currently pure-Cognito
 *   API and run on every request, not just subscribe. `addPantryItem`/
 *   `updatePantryItem`/`deletePantryItem` are `@aws_subscribe`d in the SDL;
 *   `bulkAddPantryItems` deliberately is not (§11.2.1 — a list payload can't
 *   fan out to this subscription's single-`PantryItem` shape).
 *
 * - `Query.recipes`, `Recipe.ingredients` — W6 slice S2
 *   (E2E_MVP_PLAN.md §12.3). `Query.recipes` is member-gated the same way
 *   as `Query.pantry`, with `recipes`' RLS policy (S1) as layer-3
 *   defense-in-depth behind it, and deliberately never selects/joins
 *   `recipe_ingredients`. `Recipe.ingredients` is its own field resolver
 *   (the `User.households` pattern) with NO `householdId` to gate on at
 *   this layer — `recipe_ingredients`' parent-join RLS policy (S1) is the
 *   sole authorization here, not defense-in-depth (§12.2.2/§12.5.2, the
 *   highest-severity item in this slice).
 * - `Mutation.createRecipe` — W6 slice S3 (E2E_MVP_PLAN.md §12.3).
 *   Member-gated like `addPantryItem`; inserts the parent `recipes` row
 *   plus N `recipe_ingredients` rows in one transaction (a failure on
 *   ingredient *k* rolls back everything, the `bulkAddPantryItems`
 *   rollback shape). `role` is required in the SDL with no server default
 *   — the "role assignment required" DoD gate's actual enforcement point.
 * - `Mutation.updateRecipe`, `Mutation.deleteRecipe` — W6 slice S4
 *   (E2E_MVP_PLAN.md §12.3). Both take only `id` (no `householdId`), the
 *   `updatePantryItem`/`deletePantryItem` pattern — RLS alone gates them,
 *   and a nonexistent id or one in another household both surface as the
 *   identical `NotFoundError`. `updateRecipe` gives `ingredients`/`steps`
 *   a third patch semantic (§12.2.4): present (even `[]`) replaces the
 *   whole list, absent leaves it untouched — everything else is the usual
 *   absent-means-unchanged/explicit-null-rejected patch convention.
 * - `Mutation.favoriteRecipe`, `Mutation.setInRotation` — W6 slice S5
 *   (E2E_MVP_PLAN.md §12.3). Same `id`-only, RLS-gated pattern as
 *   `updateRecipe`/`deleteRecipe`. Both are single-column flag sets
 *   (caller supplies the end state, not a toggle — idempotent by
 *   construction) and both flags are household-level, not per-user
 *   (PRD §7.1) — any member's call changes what every member sees.
 * - `Subscription.onRecipeChanged` — W6 slice S11 (E2E_MVP_PLAN.md §12.3,
 *   D6 — pulled forward from a planner-recommended W8). Identical
 *   subscribe-time Lambda-resolver authorization shape as
 *   `onPantryChanged` above. `@aws_subscribe`d to all five recipe
 *   mutations (`createRecipe`/`updateRecipe`/`deleteRecipe`/
 *   `favoriteRecipe`/`setInRotation`) — unlike `onPantryChanged`, every
 *   recipe mutation returns a single `Recipe!`, so there is no
 *   list-shaped-payload exclusion to make here.
 * - `Query.recipe` — W6 slice S7 (E2E_MVP_PLAN.md §12.3), added mid-slice
 *   (not in the original SDL/plan text) so the Detail screen can read one
 *   recipe without re-fetching the whole household's `Query.recipes` list
 *   just to select `ingredients` on a single row. Same `id`-only, RLS-gated
 *   pattern as `updateRecipe`/`deleteRecipe`/`favoriteRecipe`/
 *   `setInRotation` — no `householdId`, a nonexistent id and a real id in
 *   another household both surface as the identical `NotFoundError`.
 * - `Subscription.onHouseholdChanged` — W8 slice S10 (E2E_MVP_PLAN.md
 *   §14.2.10, D4/D5) — closes the Phase 1 DoD line ("Household settings
 *   persist and sync across devices via `onHouseholdChanged` subscription")
 *   that had shipped only as `HouseholdSyncPolicy`'s poll. Identical
 *   subscribe-time Lambda-resolver authorization shape as
 *   `onPantryChanged`/`onRecipeChanged` above. `@aws_subscribe`d to
 *   `joinHousehold`/`rotateInviteCode`/`updateHouseholdSettings` only —
 *   `updateHouseholdSettings` had to widen its own return type from
 *   `HouseholdSettings!` to `Household!` for this (a locked-SDL change,
 *   D4). `leaveHousehold`/`deleteHousehold` are deliberately NOT attached:
 *   both return `Boolean!`, a structural type mismatch against a
 *   `Household`-shaped subscription regardless of authorization, and even
 *   setting that aside, either would need to hydrate a `Household` (members
 *   + settings, via `buildGraphQLHousehold`) for a caller who has just
 *   stopped being a member — the same thing `requireHouseholdMember` would
 *   deny them at that point. See the SDL's own doc comment on this field for
 *   the full reasoning. A member leaving/a household being deleted stays a
 *   poll-free but *push*-free staleness gap, closed on next route entry or
 *   foreground instead.
 *
 * Only `_health` stays out of the VPC (no DB access needed) — the rest are
 * VPC-attached, connecting to Aurora as the least-privileged `parimaan_app`
 * role (never the cluster's admin credentials).
 */
export class ApiStack extends cdk.Stack {
  public readonly api: GraphqlApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { envName } = props;
    // Same aws-cdk-lib type-declaration quirk as data-stack.ts's `vpc` cast —
    // `UserPool` implements every member `IUserPool` needs at runtime; this
    // is purely an `exactOptionalPropertyTypes` structural-mismatch artifact.
    const userPool = props.userPool as IUserPool;

    this.api = new GraphqlApi(this, 'Api', {
      name: `parimaan-${envName}`,
      definition: Definition.fromFile(join(__dirname, '../../shared/schema.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
      xrayEnabled: true,
      logConfig: { fieldLogLevel: FieldLogLevel.ERROR },
    });

    this.createHealthResolver();
    this.createHouseholdResolvers(props);
    this.createAiAndNetResolvers(props);

    // Build-time config for the Flutter mobile app
    // (`mobile/lib/app/config/dev_config.dart` — see docs/RUNBOOK.md for the
    // transcription step). Not a secret: every request to this endpoint is
    // Cognito-authorized (`AuthorizationType.USER_POOL` above), so knowing
    // the URL grants nothing on its own. Nothing else from this stack is
    // exported — the Aurora endpoint, the app-role secret ARN, and the
    // Lambda security group are all server-side and must stay unexported.
    // Env-scoped because CloudFormation export names are unique per
    // account+region.
    new cdk.CfnOutput(this, 'GraphQlUrl', {
      value: this.api.graphqlUrl,
      description: 'AppSync GraphQL endpoint URL for the mobile app build-time config.',
      exportName: `Parimaan-${envName}-GraphQlUrl`,
    });
  }

  private createHealthResolver(): void {
    const healthFn = new NodejsFunction(this, 'HealthFn', {
      entry: join(__dirname, '../../api/src/resolvers/health.ts'),
      // Lambda RUNTIME only — local dev tooling (.nvmrc, pnpm, CI) stays on
      // Node 20 by deliberate choice. nodejs20.x was confirmed already
      // deprecated by AWS (CFN validation warning: deprecated 2026-04-30,
      // new-resource creation disabled 2027-02-01); bumped now while only
      // one Lambda exists, per AWS's own suggested target in that warning.
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
      // See `createDbResolverFunction`'s identical `esbuildArgs` comment.
      bundling: { esbuildArgs: { '--log-level': 'error' } },
    });

    const healthDataSource = this.api.addLambdaDataSource('HealthDataSource', healthFn);
    healthDataSource.createResolver('HealthResolver', {
      typeName: 'Query',
      fieldName: '_health',
    });
  }

  private createHouseholdResolvers(props: ApiStackProps): void {
    const { dbCluster, appRoleSecret, lambdaSecurityGroup, cacheTable } = props;
    // Same `exactOptionalPropertyTypes` quirk as data-stack.ts's `vpc` cast —
    // `Vpc` implements every member `IVpc` needs at runtime.
    const vpc = props.vpc as IVpc;
    const dbDeps = { vpc, dbCluster, appRoleSecret, lambdaSecurityGroup };

    for (const entry of DB_RESOLVERS) {
      const fn = this.createDbResolverFunction(`${entry.id}Fn`, entry.entryFile, dbDeps);

      // Only the rate-limited resolvers get the cache table, and only the one
      // DynamoDB action their limiter actually calls (a single atomic
      // increment-with-cap — api/src/rateLimit/dailyActionLimiter.ts). Not
      // the broader `grantWriteData`/`grantReadData` CDK convenience grants,
      // which would include Put/Delete/BatchWrite/Query/Scan these Lambdas
      // never use. Applied generically here so a future limited resolver
      // cannot accidentally get a wider grant by copy-paste.
      if (entry.needsCacheTable === true) {
        fn.addEnvironment('CACHE_TABLE_NAME', cacheTable.tableName);
        cacheTable.grant(fn, 'dynamodb:UpdateItem');
      }

      this.wireResolver(entry.id, fn, entry.typeName, entry.fieldName);
    }
  }

  /**
   * Wires `AI_RESOLVERS`/`NET_RESOLVERS` — `parseFreeformRecipe` (S3) is
   * the first real entry to synthesize anything; `NET_RESOLVERS` stays
   * empty until S5. `createNonVpcResolverFunction` itself — the actual
   * Lambda construct shape — is also unit-tested standalone in
   * `infra/test/nonVpcResolver.test.ts`.
   *
   * The secret is referenced by name, not created here — `parimaan/gemini-
   * api-key` is created out-of-band in the Secrets Manager console (same
   * as `parimaan/google-oauth-secret`, §13.2.2 point 3), never as a CDK
   * literal and never in this repo. The cache table grant mirrors
   * `createHouseholdResolvers`'s own `needsCacheTable` handling exactly —
   * one narrow `dynamodb:UpdateItem`, not the broader `grantWriteData`/
   * `grantReadData` convenience grants this Lambda category has no use for.
   */
  private createAiAndNetResolvers(props: ApiStackProps): void {
    const { cacheTable } = props;
    const geminiApiKeySecret = SecretsManagerSecret.fromSecretNameV2(this, 'GeminiApiKeySecret', 'parimaan/gemini-api-key');

    for (const entry of [...AI_RESOLVERS, ...NET_RESOLVERS]) {
      const needsGeminiSecret = entry.needsGeminiSecret === true;
      const needsCacheTable = entry.needsCacheTable === true;
      const fn = createNonVpcResolverFunction(this, `${entry.id}Fn`, {
        entry: join(__dirname, `../../api/src/resolvers/${entry.entryFile}`),
        environment: needsGeminiSecret ? { GEMINI_API_KEY_SECRET_ARN: geminiApiKeySecret.secretArn } : {},
      });

      if (needsGeminiSecret) {
        geminiApiKeySecret.grantRead(fn);
      }
      if (needsCacheTable) {
        fn.addEnvironment('CACHE_TABLE_NAME', cacheTable.tableName);
        cacheTable.grant(fn, 'dynamodb:UpdateItem');
      }

      this.wireResolver(entry.id, fn, entry.typeName, entry.fieldName);
    }
  }

  /** Adds a Lambda data source and its resolver for one GraphQL field, sharing the `<Name>DataSource`/`<Name>Resolver` logical-id convention every resolver in this stack already follows. */
  private wireResolver(name: string, fn: NodejsFunction, typeName: string, fieldName: string): void {
    const dataSource = this.api.addLambdaDataSource(`${name}DataSource`, fn);
    dataSource.createResolver(`${name}Resolver`, { typeName, fieldName });
  }

  /**
   * Shared config for every database-backed resolver Lambda in
   * `DB_RESOLVERS`: VPC subnet placement, the shared
   * `lambdaSecurityGroup`, and env vars for
   * connecting to Aurora as `parimaan_app` (never the cluster's admin
   * secret — these Lambdas only ever get read access to `appRoleSecret`).
   */
  private createDbResolverFunction(
    id: string,
    entryFile: string,
    deps: {
      vpc: IVpc;
      dbCluster: DatabaseCluster;
      appRoleSecret: Secret;
      lambdaSecurityGroup: ISecurityGroup;
    },
  ): NodejsFunction {
    const { vpc, dbCluster, appRoleSecret, lambdaSecurityGroup } = deps;

    const fn = new NodejsFunction(this, id, {
      entry: join(__dirname, `../../api/src/resolvers/${entryFile}`),
      runtime: Runtime.NODEJS_24_X,
      handler: 'handler',
      vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSecurityGroup],
      // Aurora Serverless v2's auto-pause resume can take up to ~30s (the
      // mobile app's own copy — `NameHouseholdScreen.coldStartHint` — tells
      // the user exactly that), and connecting is only the first part of an
      // invocation that then still has to run the actual query/transaction.
      // A 30s function timeout left no headroom at all for that: a genuine
      // first-request-after-pause reliably timed out at the *connection*
      // step alone (`pool.ts`'s `connectionTimeoutMillis`, previously 5s —
      // shorter still), well before the function timeout ever mattered.
      // Caught only by a real cold Aurora invocation — nothing synth-time or
      // unit-tested exercises actual connection latency. 45s leaves roughly
      // 10-15s for the query itself after the worst-case 30s resume.
      timeout: cdk.Duration.seconds(45),
      memorySize: 512,
      tracing: Tracing.ACTIVE,
      // No `reservedConcurrentExecutions` here (yet). There is no RDS Proxy
      // in front of Aurora (locked decision, `SYSTEM_DESIGN.md` §7.1/
      // `E2E_MVP_PLAN.md` §10 Q1), so every concurrent Lambda invocation is
      // its own Postgres connection, and a per-function reservation is the
      // intended long-term guard against a burst opening more connections
      // than Aurora can hold. It is left unset right now because this AWS
      // account currently has a fresh-account Lambda concurrency quota of
      // only 10 *total*, and AWS rejects any reservation that would leave
      // fewer than 10 unreserved — so even one reserved execution on one
      // function fails deployment outright today. The account's own
      // 10-execution ceiling already bounds simultaneous Aurora connections
      // far more tightly than a reservation would have, so nothing is
      // actually unprotected in the meantime — this is a today's-account-
      // limits accommodation, not a safety rollback. Add
      // `reservedConcurrentExecutions: 5` (or similar, weighed against
      // `data-stack.ts`'s `AuroraConnectionsAlarm` threshold) back once a
      // quota increase is requested and granted.
      environment: {
        APP_ROLE_SECRET_ARN: appRoleSecret.secretArn,
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_NAME: 'parimaan',
      },
      // See `data-stack.ts`'s identical `esbuildArgs` comment — trims
      // esbuild's own CLI logging, a documented aggravating factor in a
      // CI-only Vitest worker-IPC-heartbeat flake. This is the largest
      // single contributor: every `DB_RESOLVERS` entry is built through
      // this one factory.
      bundling: { esbuildArgs: { '--log-level': 'error' } },
    });

    appRoleSecret.grantRead(fn);
    return fn;
  }
}
