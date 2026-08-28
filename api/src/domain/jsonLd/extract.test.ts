import { describe, expect, it } from 'vitest';
import { extractJsonLdBlocks } from './extract.js';

describe('extractJsonLdBlocks', () => {
  it('returns an empty array for a page with no ld+json script tags', () => {
    expect(extractJsonLdBlocks('<html><head><title>No JSON-LD</title></head><body></body></html>')).toEqual([]);
  });

  it('extracts and parses a single well-formed block', () => {
    const html = '<html><head><script type="application/ld+json">{"@type":"Recipe","name":"Test"}</script></head></html>';
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Recipe', name: 'Test' }]);
  });

  it('extracts every block when a page has more than one', () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Test"}</script>
      </head></html>`;
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Organization' }, { '@type': 'Recipe', name: 'Test' }]);
  });

  it('repairs a raw newline embedded inside a JSON string value (real S1 defect class)', () => {
    const html = '<html><head><script type="application/ld+json">{"@type":"Recipe","description":"Line one\nLine two"}</script></head></html>';
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Recipe', description: 'Line one\nLine two' }]);
  });

  it('rejects a page whose HTML tag nesting is deeper than the safety cap before ever calling cheerio, and returns quickly', () => {
    const deeplyNested = `<html><body>${'<div>'.repeat(50_000)}<script type="application/ld+json">{"@type":"Recipe","name":"Should never be reached"}</script></body></html>`;
    const start = Date.now();
    expect(extractJsonLdBlocks(deeplyNested)).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('still parses a normally-nested real-world page (well under the depth cap)', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Recipe","name":"Test"}</script></head><body>${'<div>'.repeat(50)}content${'</div>'.repeat(50)}</body></html>`;
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Recipe', name: 'Test' }]);
  });

  it('does not count unclosed void elements (meta/link/img/br) as nesting depth — an image-heavy, ad-laden real blog must not be spuriously rejected', () => {
    const metaTags = '<meta name="x" content="y">'.repeat(60);
    const linkTags = '<link rel="stylesheet" href="x.css">'.repeat(20);
    const imgTags = '<img src="thumb.jpg" alt="x">'.repeat(400);
    const html = `<html><head>${metaTags}${linkTags}<script type="application/ld+json">{"@type":"Recipe","name":"Test"}</script></head><body>${imgTags}</body></html>`;
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Recipe', name: 'Test' }]);
  });

  it('skips a single JSON-LD block over the size cap, without throwing and without blocking other blocks on the same page', () => {
    const oversized = `{"@type":"Recipe","name":"${'x'.repeat(2_000_001)}"}`;
    const html = `
      <html><head>
      <script type="application/ld+json">${oversized}</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Still readable"}</script>
      </head></html>`;
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Recipe', name: 'Still readable' }]);
  });

  it('skips a block that is malformed for a reason other than a raw control character, without throwing', () => {
    const html = `
      <html><head>
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">{"@type":"Recipe","name":"Still readable"}</script>
      </head></html>`;
    expect(extractJsonLdBlocks(html)).toEqual([{ '@type': 'Recipe', name: 'Still readable' }]);
  });
});
