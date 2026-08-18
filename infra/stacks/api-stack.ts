import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import {
  AuthorizationType,
  Definition,
  FieldLogLevel,
  GraphqlApi,
} from 'aws-cdk-lib/aws-appsync';
import type { IUserPool, UserPool } from 'aws-cdk-lib/aws-cognito';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

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
}

/**
 * AppSync GraphQL API, Cognito-authorized, plus one real Lambda-backed
 * resolver for the placeholder `Query._health` field — proves the
 * AppSync → Lambda → response pipeline end-to-end before any real business
 * logic lands. See SYSTEM_DESIGN.md §6.1-§6.3 and E2E_MVP_PLAN.md §16
 * ("api-stack (AppSync + hello-world resolver)").
 *
 * Real household/pantry/recipe resolvers are later, heavier work once this
 * skeleton exists — deliberately out of scope here.
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

    const healthFn = new NodejsFunction(this, 'HealthFn', {
      entry: join(__dirname, '../../api/src/resolvers/health.ts'),
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
    });

    const healthDataSource = this.api.addLambdaDataSource('HealthDataSource', healthFn);
    healthDataSource.createResolver('HealthResolver', {
      typeName: 'Query',
      fieldName: '_health',
    });
  }
}
