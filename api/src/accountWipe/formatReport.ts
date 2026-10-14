import type { WipeOutcome } from './runWipe.js';
import type { WipeListing } from './types.js';

const SAMPLE_SIZE = 5;

const samples = (items: readonly string[]): string => {
  const shown = items.slice(0, SAMPLE_SIZE).join(', ');
  const more = items.length - SAMPLE_SIZE;
  return more > 0 ? `${shown} ... and ${more} more` : shown;
};

const line = (label: string, count: number, ids: readonly string[]): string =>
  `  ${label.padEnd(26)} ${String(count).padStart(5)}${count > 0 ? `   ${samples(ids)}` : ''}`;

const listingLines = (listing: WipeListing): string[] => {
  const { db } = listing;
  const out: string[] = [];
  out.push(`Emails: ${listing.emails.join(', ')}`);
  out.push('');
  out.push('Cognito users');
  out.push(
    line('cognito users', listing.cognito.length, listing.cognito.map((u) => `${u.username}(${u.sub})`)),
  );
  out.push('');
  out.push('Database (deletion order, one transaction)');
  out.push(line('users matched', db.users.length, db.users.map((u) => `${u.id} ${u.email}`)));
  out.push(
    line('households DELETED', db.householdsDeleted.length, db.householdsDeleted.map((h) => `${h.id} "${h.name}"`)),
  );
  for (const table of db.tables) {
    out.push(line(table.table, table.keys.length, table.keys));
  }
  out.push('');
  out.push('Households KEPT (shared with non-wipe users; only wiped memberships removed)');
  if (db.householdsKept.length === 0) {
    out.push('  none');
  }
  for (const h of db.householdsKept) {
    out.push(
      `  ${h.id} "${h.name}": ${h.remainingMemberCount} member(s) remain, ${h.wipedMemberCount} removed`,
    );
  }
  for (const p of db.promotions) {
    out.push(`  promote ${p.newPrimaryUserId} to primary of ${p.householdId}`);
  }
  out.push('');
  out.push('Attribution columns nulled in KEPT households (rows are kept)');
  for (const r of db.nullifiedReferences) {
    out.push(`  ${`${r.table}.${r.column}`.padEnd(32)} ${String(r.count).padStart(5)}`);
  }
  out.push('');
  out.push('Other stores');
  out.push(line('s3 objects', listing.objects.length, listing.objects.map((o) => `${o.bucket}/${o.key}`)));
  out.push(line('dynamodb cache items', listing.cache.length, listing.cache.map((c) => c.pk)));
  return out;
};

export const formatReport = (outcome: WipeOutcome): string => {
  const out = [...listingLines(outcome.listing), ''];
  out.push(`Listing hash: ${outcome.hash}`);
  if (outcome.mode === 'dry-run') {
    out.push('');
    out.push('DRY RUN: nothing was changed.');
    out.push(`To delete exactly this, after approval: --execute --confirm ${outcome.hash}`);
  } else {
    out.push('');
    out.push('EXECUTED. Rows deleted per table:');
    for (const d of outcome.dbResult.deletedByTable) {
      out.push(`  ${d.table.padEnd(26)} ${String(d.count).padStart(5)}`);
    }
    out.push(`  primary promotions applied: ${outcome.dbResult.promotionsApplied}`);
    out.push(
      `Verification: ${outcome.remaining.total} item(s) remain ` +
        `(db ${outcome.remaining.dbRows}, s3 ${outcome.remaining.objects}, ` +
        `cache ${outcome.remaining.cacheItems}, cognito ${outcome.remaining.cognitoUsers}).`,
    );
  }
  return out.join('\n');
};
