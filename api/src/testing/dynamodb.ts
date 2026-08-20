import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

const DYNAMODB_LOCAL_IMAGE = 'amazon/dynamodb-local:latest';
const CONTAINER_PORT = 8000;

export interface TestDynamoDb {
  client: DynamoDBDocumentClient;
  tableName: string;
  stop: () => Promise<void>;
}

/**
 * Boots a fresh ephemeral `amazon/dynamodb-local` container and a single
 * table matching `infra/stacks/data-stack.ts`'s `DataStack.cacheTable`
 * schema (`PK`/`SK` string keys, single-table design). Mirrors
 * `testing/postgres.ts`'s `startTestDatabase` pattern: real backing service
 * in tests, not a mocked client — this repo's established convention for
 * anything security/correctness-relevant (see that file's own comment).
 *
 * There is no official `@testcontainers/dynamodb` package as clean as
 * `@testcontainers/postgresql`, so this uses `testcontainers`'s generic
 * `GenericContainer` API directly against the official DynamoDB Local image.
 */
export const startTestDynamoDb = async (): Promise<TestDynamoDb> => {
  const container: StartedTestContainer = await new GenericContainer(DYNAMODB_LOCAL_IMAGE)
    .withExposedPorts(CONTAINER_PORT)
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(CONTAINER_PORT)}`;
  const rawClient = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  const tableName = 'test-cache-table';
  await rawClient.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );

  const client = DynamoDBDocumentClient.from(rawClient);

  return {
    client,
    tableName,
    stop: async (): Promise<void> => {
      rawClient.destroy();
      await container.stop();
    },
  };
};
