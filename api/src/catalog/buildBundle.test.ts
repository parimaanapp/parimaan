import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';
import { buildCatalogBundle, serialiseBundleFile } from './buildBundle.js';

const ING_HEADER =
  'id,canonical_name,app_category,app_category_label,subcategory,aliases,allowed_units,default_unit,piece_g,cup_g_override,note';
const CONV_HEADER = 'scope,subcategory_or_ingredient,unit,base_unit,amount_per_unit';

const ingredientsCsv = (...rows: string[]): string => [ING_HEADER, ...rows].join('\n') + '\n';
const conversionsCsv = (...rows: string[]): string => [CONV_HEADER, ...rows].join('\n') + '\n';

const TOOR = 'toor_dal,Toor Dal,dal,Dal,dal_pulse,arhar dal|tuvar dal,g|kg|cup,g,,200,';
const MILK = 'milk,Milk,dairy,Dairy,dairy_liquid,doodh|paal,ml|l|cup,ml,,,';
const CONV_OK = conversionsCsv('subcategory,dal_pulse,g,g,1', 'ingredient,toor_dal,cup,g,200');
const CONV_FULL = conversionsCsv(
  'subcategory,dal_pulse,g,g,1',
  'subcategory,dairy_liquid,cup,ml,240',
  'ingredient,toor_dal,cup,g,200',
);

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
    ]);
  });

  it('handles CRLF and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,b,c\n,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
    ]);
  });

  it('skips blank lines and strips a BOM', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a\n"oops\n')).toThrow(/unterminated/i);
  });
});

describe('buildCatalogBundle', () => {
  it('maps CSV columns to the bundle shape', () => {
    const bundle = buildCatalogBundle(ingredientsCsv(TOOR), CONV_OK);
    expect(bundle.ingredients).toEqual([
      {
        id: 'toor_dal',
        canonicalName: 'Toor Dal',
        appCategory: 'dal',
        subcategory: 'dal_pulse',
        aliases: ['arhar dal', 'tuvar dal'],
        allowedUnits: ['g', 'kg', 'cup'],
        defaultUnit: 'g',
        pieceG: null,
        cupG: 200,
        note: '',
      },
    ]);
  });

  it('is independent of input row order (sorted by id)', () => {
    const a = buildCatalogBundle(ingredientsCsv(TOOR, MILK), CONV_FULL);
    const b = buildCatalogBundle(ingredientsCsv(MILK, TOOR), CONV_FULL);
    expect(a).toEqual(b);
    expect(a.ingredients.map((item) => item.id)).toEqual(['milk', 'toor_dal']);
  });

  it('sorts conversions by scope, key, unit and maps columns', () => {
    const bundle = buildCatalogBundle(ingredientsCsv(TOOR, MILK), CONV_FULL);
    expect(bundle.conversions).toEqual([
      { scope: 'ingredient', key: 'toor_dal', unit: 'cup', baseUnit: 'g', amount: 200 },
      { scope: 'subcategory', key: 'dairy_liquid', unit: 'cup', baseUnit: 'ml', amount: 240 },
      { scope: 'subcategory', key: 'dal_pulse', unit: 'g', baseUnit: 'g', amount: 1 },
    ]);
  });

  it('keys ingredient conversions by id even when the CSV uses the canonical name', () => {
    const bundle = buildCatalogBundle(
      ingredientsCsv(TOOR),
      conversionsCsv('subcategory,dal_pulse,g,g,1', 'ingredient,Toor Dal,cup,g,200'),
    );
    expect(bundle.conversions).toContainEqual({
      scope: 'ingredient',
      key: 'toor_dal',
      unit: 'cup',
      baseUnit: 'g',
      amount: 200,
    });
  });

  it('drops blank and duplicate aliases', () => {
    const row = 'x,X Item,other,Other,baking_misc,a||A|b|a,g,g,,,';
    const bundle = buildCatalogBundle(
      ingredientsCsv(row),
      conversionsCsv('subcategory,baking_misc,g,g,1'),
    );
    expect(bundle.ingredients[0]?.aliases).toEqual(['a', 'b']);
  });

  it('keeps notes containing commas', () => {
    const row = 'x,X Item,other,Other,baking_misc,,g,g,,,"about 1 g, roughly"';
    const bundle = buildCatalogBundle(
      ingredientsCsv(row),
      conversionsCsv('subcategory,baking_misc,g,g,1'),
    );
    expect(bundle.ingredients[0]?.note).toBe('about 1 g, roughly');
  });

  it.each([
    ['duplicate id', ['toor_dal,Other Name,dal,Dal,dal_pulse,,g,g,,,'], /duplicate id/i],
    [
      'duplicate canonical name',
      ['toor2,toor dal,dal,Dal,dal_pulse,,g,g,,,'],
      /duplicate canonical name/i,
    ],
    ['default unit not allowed', ['a,A,dal,Dal,dal_pulse,,g|kg,cup,,,'], /default_unit/],
    ['unknown category', ['a,A,weird,Weird,dal_pulse,,g,g,,,'], /category/i],
    ['label mismatch', ['a,A,dal,Lentils,dal_pulse,,g,g,,,'], /label/i],
    ['bad piece_g', ['a,A,dal,Dal,dal_pulse,,g,g,abc,,'], /piece_g/],
    ['non-positive cup_g', ['a,A,dal,Dal,dal_pulse,,g,g,,0,'], /cup_g/],
    ['empty id', [',A,dal,Dal,dal_pulse,,g,g,,,'], /id/i],
    ['bad id characters', ['Bad Id,A,dal,Dal,dal_pulse,,g,g,,,'], /id/i],
    ['empty allowed units', ['a,A,dal,Dal,dal_pulse,,,g,,,'], /allowed_units/],
  ])('rejects %s', (_label, rows, pattern) => {
    expect(() => buildCatalogBundle(ingredientsCsv(TOOR, ...rows), CONV_OK)).toThrow(pattern);
  });

  it.each([
    ['bad scope', 'weird,dal_pulse,g,g,1', /scope/i],
    ['bad amount', 'subcategory,dal_pulse,g,g,0', /amount/i],
    ['non numeric amount', 'subcategory,dal_pulse,g,g,x', /amount/i],
    ['unknown ingredient key', 'ingredient,nope,g,g,1', /unknown ingredient/i],
    ['unknown subcategory key', 'subcategory,nope,g,g,1', /unknown subcategory/i],
    ['duplicate key', 'subcategory,dal_pulse,g,g,1\nsubcategory,dal_pulse,g,g,2', /duplicate/i],
  ])('rejects conversion %s', (_label, rows, pattern) => {
    expect(() =>
      buildCatalogBundle(ingredientsCsv(TOOR), [CONV_HEADER, rows].join('\n') + '\n'),
    ).toThrow(pattern);
  });

  it('rejects an unexpected header', () => {
    expect(() => buildCatalogBundle('id,name\nx,y\n', CONV_OK)).toThrow(/header/i);
  });

  it('accepts an arbitrarily large catalog (no hard-coded counts)', () => {
    const rows = Array.from(
      { length: 1500 },
      (_unused, i) => `item_${String(i).padStart(4, '0')},Item ${i},other,Other,baking_misc,alias ${i},g,g,,,`,
    );
    const bundle = buildCatalogBundle(
      ingredientsCsv(...rows),
      conversionsCsv('subcategory,baking_misc,g,g,1'),
    );
    expect(bundle.ingredients).toHaveLength(1500);
  });
});

describe('serialiseBundleFile', () => {
  it('is stable pretty JSON with a trailing newline', () => {
    const text = serialiseBundleFile([{ b: 1, a: [1, 2] }]);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual([{ b: 1, a: [1, 2] }]);
    expect(text).toBe(serialiseBundleFile([{ b: 1, a: [1, 2] }]));
  });
});
