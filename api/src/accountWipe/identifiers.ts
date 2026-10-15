/**
 * Every identifier that feeds an S3 prefix or a DynamoDB match must be a full
 * UUID. An empty or short value would turn `pantry-photos//` or a substring
 * match into a wildcard over other people's data, so anything else aborts.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export interface LabelledIdentifier {
  readonly kind: string;
  readonly value: string;
}

export const assertUuidIdentifiers = (identifiers: readonly LabelledIdentifier[]): void => {
  for (const { kind, value } of identifiers) {
    if (value.length === 0) {
      throw new Error(`Refusing to continue: a ${kind} is empty.`);
    }
    if (!isUuid(value)) {
      throw new Error(
        `Refusing to continue: a ${kind} is not a UUID (length ${value.length}); scans and prefixes built from it could match other accounts.`,
      );
    }
  }
};
