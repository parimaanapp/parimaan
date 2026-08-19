import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deterministic sha256 of every `.ts` migration file's name + content under
 * `dir`, sorted for order-independence. Used as a CloudFormation
 * `CustomResource` property value: CFN only re-invokes a custom resource's
 * Lambda when its `Properties` differ from the last deployed value, so
 * without a hash that changes whenever a migration file changes, adding a
 * new migration would silently never get applied by a routine `cdk deploy`.
 */
export const hashMigrationsDir = (dir: string): string => {
  const fileNames = readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();

  const hash = createHash('sha256');
  for (const fileName of fileNames) {
    hash.update(fileName);
    hash.update(readFileSync(join(dir, fileName)));
  }
  return hash.digest('hex');
};
