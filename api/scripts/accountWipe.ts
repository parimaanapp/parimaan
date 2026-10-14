/**
 * DESTRUCTIVE, DEV-ONLY. Deletes every record tied to a set of accounts
 * (E2E_MVP_PLAN.md §32.5). Read docs/RUNBOOK.md ("Account wipe tool") first.
 *
 *   pnpm --filter @parimaan/api exec tsx scripts/accountWipe.ts \
 *     --emails-file emails.txt                        # dry run (default, read-only)
 *   ... --emails-file emails.txt --execute --confirm <hash from the dry run>
 *
 * Configuration comes from the environment only; no secret is printed.
 */
import { readFileSync } from 'node:fs';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Client } from 'pg';
import { createCacheStore, createIdentityPool, createObjectStore } from '../src/accountWipe/awsPorts.js';
import { loadWipeConfig, parseCliArgs } from '../src/accountWipe/cli.js';
import { formatReport } from '../src/accountWipe/formatReport.js';
import { RDS_GLOBAL_BUNDLE_CA } from '../src/db/rdsGlobalBundleCa.js';
import { createPgWipeDb } from '../src/accountWipe/pgWipeDb.js';
import { runWipe } from '../src/accountWipe/runWipe.js';

const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2), (path) => readFileSync(path, 'utf8'));
  const config = loadWipeConfig(process.env);

  const pg = new Client({ connectionString: config.databaseUrl, ssl: { rejectUnauthorized: true, ca: RDS_GLOBAL_BUNDLE_CA },
  });
  await pg.connect();
  try {
    const region = { region: config.region };
    const outcome = await runWipe(
      {
        db: createPgWipeDb(pg),
        objects: createObjectStore(new S3Client(region)),
        cache: createCacheStore(
          DynamoDBDocumentClient.from(new DynamoDBClient(region)),
          config.cacheTable,
        ),
        identity: createIdentityPool(new CognitoIdentityProviderClient(region), config.userPoolId),
        buckets: { uploads: config.uploadsBucket, exports: config.exportsBucket },
      },
      options,
    );
    process.stdout.write(`${formatReport(outcome)}\n`);
  } finally {
    await pg.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected error'}\n`);
  process.exitCode = 1;
});
