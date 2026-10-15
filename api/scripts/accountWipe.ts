/**
 * DESTRUCTIVE, DEV-ONLY. Deletes every record tied to a set of accounts
 * (E2E_MVP_PLAN.md §32.5). Read docs/RUNBOOK.md ("Account wipe tool") first.
 *
 *   pnpm --filter @parimaan/api exec tsx scripts/accountWipe.ts \
 *     --emails-file emails.txt                        # dry run (default, read-only)
 *   ... --emails-file emails.txt --full-listing listing.json   # also write the whole listing
 *   ... --emails-file emails.txt --execute --confirm <hash from the dry run>
 *
 * Configuration comes from the environment only; no secret is printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Client } from 'pg';
import { createCacheStore, createIdentityPool, createObjectStore } from '../src/accountWipe/awsPorts.js';
import { loadWipeConfig, parseCliArgs } from '../src/accountWipe/cli.js';
import { formatFullListing, formatReport } from '../src/accountWipe/formatReport.js';
import { RDS_GLOBAL_BUNDLE_CA } from '../src/db/rdsGlobalBundleCa.js';
import { createPgWipeDb } from '../src/accountWipe/pgWipeDb.js';
import { runWipe } from '../src/accountWipe/runWipe.js';
import { createTargetVerifier } from '../src/accountWipe/target.js';

const main = async (): Promise<void> => {
  const options = parseCliArgs(process.argv.slice(2), (path) => readFileSync(path, 'utf8'));
  const config = loadWipeConfig(process.env);

  const pg = new Client({
    connectionString: config.databaseUrl,
    ssl: {
      rejectUnauthorized: true,
      ca: RDS_GLOBAL_BUNDLE_CA,
      // For an SSM port-forward the URL host is localhost; verify the certificate against the real RDS host.
      ...(config.dbServername !== undefined ? { servername: config.dbServername } : {}),
    },
  });
  await pg.connect();
  try {
    const region = { region: config.region };
    const cognitoClient = new CognitoIdentityProviderClient(region);
    const outcome = await runWipe(
      {
        target: createTargetVerifier({
          sts: new STSClient(region),
          cognito: cognitoClient,
          userPoolId: config.userPoolId,
          dbHost: config.dbHost,
          expected: config.expected,
        }),
        db: createPgWipeDb(pg),
        objects: createObjectStore(new S3Client(region)),
        cache: createCacheStore(
          DynamoDBDocumentClient.from(new DynamoDBClient(region)),
          config.cacheTable,
        ),
        identity: createIdentityPool(cognitoClient, config.userPoolId),
        buckets: { uploads: config.uploadsBucket, exports: config.exportsBucket },
      },
      options,
    );
    if (options.fullListingPath !== undefined) {
      // Contains emails and ids: owner-only file.
      writeFileSync(options.fullListingPath, formatFullListing(outcome), { mode: 0o600 });
      process.stdout.write(`Full listing written to ${options.fullListingPath}\n`);
    }
    process.stdout.write(`${formatReport(outcome)}\n`);
  } finally {
    await pg.end();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected error'}\n`);
  process.exitCode = 1;
});
