/**
 * Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, embedded commas
 * and newlines, CRLF). Blank lines are skipped and a leading BOM is ignored.
 * Written here rather than adding a dependency: the input is two committed
 * files this repo controls.
 */

interface ParserState {
  rows: string[][];
  row: string[];
  field: string;
  inQuotes: boolean;
  fieldStarted: boolean;
}

const endField = (state: ParserState): void => {
  state.row.push(state.field);
  state.field = '';
  state.fieldStarted = false;
};

const endRow = (state: ParserState): void => {
  endField(state);
  if (state.row.length > 1 || state.row[0] !== '') {
    state.rows.push(state.row);
  }
  state.row = [];
};

/** Consumes one character inside a quoted field; returns how many extra characters were consumed. */
const stepQuoted = (state: ParserState, char: string, next: string): number => {
  if (char !== '"') {
    state.field += char;
    return 0;
  }
  if (next === '"') {
    state.field += '"';
    return 1;
  }
  state.inQuotes = false;
  return 0;
};

/** Consumes one character outside quotes; returns how many extra characters were consumed. */
const stepUnquoted = (state: ParserState, char: string, next: string): number => {
  if (char === '"' && !state.fieldStarted) {
    state.inQuotes = true;
    state.fieldStarted = true;
  } else if (char === ',') {
    endField(state);
  } else if (char === '\n') {
    endRow(state);
  } else if (char === '\r') {
    // CRLF ends the row on the LF; a bare CR ends it here.
    if (next !== '\n') {
      endRow(state);
    }
  } else {
    state.field += char;
    state.fieldStarted = true;
  }
  return 0;
};

export const parseCsv = (text: string): string[][] => {
  const input = text.startsWith('﻿') ? text.slice(1) : text;
  const state: ParserState = { rows: [], row: [], field: '', inQuotes: false, fieldStarted: false };

  for (let i = 0; i < input.length; i += 1) {
    const char = input.charAt(i);
    const next = input.charAt(i + 1);
    i += state.inQuotes ? stepQuoted(state, char, next) : stepUnquoted(state, char, next);
  }

  if (state.inQuotes) {
    throw new Error('CSV parse error: unterminated quoted field');
  }
  if (state.fieldStarted || state.field !== '' || state.row.length > 0) {
    endRow(state);
  }
  return state.rows;
};
