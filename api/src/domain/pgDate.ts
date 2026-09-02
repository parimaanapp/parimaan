/**
 * `YYYY-MM-DD` from a `pg`-parsed `DATE` column's `Date` object.
 *
 * Deliberately reads LOCAL components (`getFullYear`/`getMonth`/`getDate`),
 * not `toISOString()`'s UTC ones — `pg`'s underlying `postgres-date` parser
 * constructs this `Date` at *local* midnight of the SQL date, not UTC
 * midnight (verified empirically: on a UTC+5:30 machine, a `DATE` of
 * `2027-03-01` round-tripped through `toISOString().slice(0, 10)` came back
 * as `2027-02-28` — an off-by-one-day bug first caught in
 * `pantryRepository.ts`'s `expiryDate` mapping and then genuinely
 * regressed once already, independently, in `menuRepository.ts`'s
 * `weekStartDate` mapping — pulled out to one shared function specifically
 * so a third call site can't reintroduce it a second time). Using local
 * getters here reads back the same calendar date the parser was
 * constructed from, regardless of the process's timezone.
 */
export const toAwsDateString = (value: Date): string => {
  const year = value.getFullYear().toString().padStart(4, '0');
  const month = (value.getMonth() + 1).toString().padStart(2, '0');
  const day = value.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};
