import { describe, expect, it } from 'vitest';
import { cleanText, decodeHtmlEntities } from './text.js';

describe('decodeHtmlEntities', () => {
  it.each([
    ['&quot; piece of cinnamon', '" piece of cinnamon'],
    ['salt &amp; pepper', 'salt & pepper'],
    ['Ginger&#39;s paste', "Ginger's paste"],
    ['Ginger&#x27;s paste', "Ginger's paste"],
    ['a&nbsp;b', 'a b'],
    ['&lt;b&gt;', '<b>'],
    ['&apos;x&apos;', "'x'"],
    ['caf&#233;', 'café'],
    ['&ndash;&mdash;&hellip;', '–—…'],
    ['&amp;quot;x&amp;quot;', '"x"'],
    ['&unknown; stays', '&unknown; stays'],
    ['&#99999999999; stays', '&#99999999999; stays'],
    ['no entities', 'no entities'],
    ['', ''],
  ])('decodes %j to %j', (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });
});

describe('cleanText', () => {
  it.each([
    ['  two   spaces \n and\ttabs ', 'two spaces and tabs'],
    ['1&nbsp;&nbsp;cup', '1 cup'],
    ['&quot;hi&quot;', '"hi"'],
    ['', ''],
  ])('cleans %j to %j', (input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });
});
