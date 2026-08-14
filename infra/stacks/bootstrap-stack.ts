import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface BootstrapStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
}

/**
 * Placeholder stack for Sprint 0.
 *
 * Declares no resources. It exists so the CDK app synthesizes and the placeholder
 * assertions test has a target (DEV_WORKFLOW.md §5 step 3d).
 *
 * Replaced in W1+ by the six real stacks in SYSTEM_DESIGN.md §12.3:
 * network, auth, data, api, frontend, observability.
 */
export class BootstrapStack extends cdk.Stack {
  public readonly envName: 'dev' | 'prod';

  constructor(scope: Construct, id: string, props: BootstrapStackProps) {
    super(scope, id, props);
    this.envName = props.envName;
  }
}
