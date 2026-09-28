/**
 * W20 D1 (`E2E_MVP_PLAN.md` §27.2) — pantry-photo object keys are scoped to
 * the CALLER, `pantry-photos/{cognitoSub}/{uuid}.jpg`, not to a household.
 * A photo is transient input, not household data (it only becomes household
 * data through the confirmed `bulkAddPantryItems`, which already checks
 * membership), so ownership can be proven from the key alone — which is
 * what lets both photo resolvers run in the non-VPC Lambda category with no
 * Aurora route and no `householdId` argument they'd have no way to
 * authorize (`nonVpcResolver.ts`'s own doc).
 *
 * `isOwnPantryPhotoKey` is the ONLY thing standing between
 * `analyzePantryPhoto(s3Key)` (S4) and reading another user's kitchen
 * photo, so it is a strict whole-string match on the exact shape the
 * presign produces — no traversal, no nesting, no other prefix, no other
 * extension — rather than a `startsWith` check.
 */
export const PANTRY_PHOTO_PREFIX = 'pantry-photos';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(`^${PANTRY_PHOTO_PREFIX}/(${UUID})/${UUID}\\.jpg$`);

export const buildPantryPhotoKey = (cognitoSub: string, objectId: string): string =>
  `${PANTRY_PHOTO_PREFIX}/${cognitoSub}/${objectId}.jpg`;

export const isOwnPantryPhotoKey = (cognitoSub: string, key: string): boolean => {
  const match = KEY_PATTERN.exec(key);
  return match !== null && match[1] === cognitoSub;
};
