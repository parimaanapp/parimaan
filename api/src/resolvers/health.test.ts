import { describe, expect, it } from 'vitest';
import type { AppSyncResolverEvent } from 'aws-lambda';
import { handler } from './health.js';

/**
 * Minimal but representative direct-Lambda-resolver event, shaped like what
 * AppSync actually invokes the Lambda with for `Query._health` (no
 * arguments, no source, an authenticated Cognito identity). Direct Lambda
 * resolvers are NOT VTL-mapped and are NOT API Gateway proxy events — the
 * handler's return value becomes the field's GraphQL response directly, with
 * no `{ statusCode, body }` wrapper.
 */
const buildFakeEvent = (): AppSyncResolverEvent<Record<string, never>> => ({
  arguments: {},
  identity: {
    sub: 'fake-user-sub',
    issuer: 'https://cognito-idp.ap-south-1.amazonaws.com/fake-pool-id',
    username: 'fake-user',
    claims: {},
    sourceIp: ['127.0.0.1'],
    defaultAuthStrategy: 'ALLOW',
    groups: null,
  },
  source: null,
  request: {
    headers: {},
    domainName: null,
  },
  info: {
    selectionSetList: ['_health'],
    selectionSetGraphQL: '{ _health }',
    parentTypeName: 'Query',
    fieldName: '_health',
    variables: {},
  },
  prev: null,
  stash: {},
});

describe('health resolver handler', () => {
  it('returns the literal string "ok" for Query._health', async () => {
    const result = await handler(buildFakeEvent());
    expect(result).toBe('ok');
  });

  it('returns a plain string, not an API-Gateway-shaped { statusCode, body } wrapper', async () => {
    // Direct Lambda resolvers are not API Gateway — the field's response IS
    // the return value. Guards against accidentally reusing an API Gateway
    // handler pattern here.
    const result = await handler(buildFakeEvent());
    expect(typeof result).toBe('string');
    expect(result).not.toHaveProperty('statusCode');
    expect(result).not.toHaveProperty('body');
  });

  it('returns the same result regardless of identity/arguments on the event (no logic branches yet)', async () => {
    const eventWithNullIdentity: AppSyncResolverEvent<Record<string, never>> = {
      ...buildFakeEvent(),
      identity: null,
    };
    const result = await handler(eventWithNullIdentity);
    expect(result).toBe('ok');
  });
});
