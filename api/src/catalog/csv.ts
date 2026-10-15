/**
 * Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, embedded commas
 * and newlines, CRLF). Blank lines are skipped and a leading BOM is ignored.
 * Written here rather than adding a dependency: the input is two committed
 * files this repo controls.
 */
export const parseCsv = (text: string): string[][] => {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (input.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      if (input.charAt(i + 1) !== '\n') {
        endRow();
      }
    } else {
      field += char;
      fieldStarted = true;
    }
  }

  if (inQuotes) {
    throw new Error('CSV parse error: unterminated quoted field');
  }
  if (fieldStarted || field !== '' || row.length > 0) {
    endRow();
  }
  return rows;
};
