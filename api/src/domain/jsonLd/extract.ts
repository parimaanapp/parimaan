import * as cheerio from 'cheerio';

/**
 * S1's own 20 real fixtures' `<script type="application/ld+json">` content
 * tops out around 12 KB (the largest, `hebbarskitchen`, is a Yoast schema
 * graph). This module is pure (no network, no fetch of its own) and has no
 * visibility into whatever HTTP-layer response-size cap its eventual
 * caller (S5's `importRecipeFromUrl`) applies to the whole page — so it
 * cannot assume one exists upstream. A skipped-not-thrown cap here, well
 * above any real block, is this module's own defence against a single
 * pathologically large `<script>` block being fully scanned and parsed
 * (flagged by `security-reviewer`).
 */
const MAX_JSON_LD_BLOCK_LENGTH = 2_000_000;

/**
 * `cheerio.load` (via `parse5`'s spec-compliant HTML5 tree-construction
 * algorithm) is measurably **quadratic-or-worse in nesting depth**, not
 * just byte size — `security-reviewer` benchmarked ~120ms at 5,000 levels
 * of unclosed `<div>` and multi-second/multi-minute hangs at 40,000-
 * 200,000, on payloads well under any reasonable page-size cap (a few
 * hundred KB to ~1 MB). Since this is synchronous, CPU-bound work, no
 * `setTimeout`/deadline can interrupt it once started — it blocks the
 * whole Node event loop, taking down the process for every concurrent
 * request, not just the one that triggered it. A byte-size cap alone does
 * not close this: the blowup is driven by depth, not size.
 *
 * `countMaxTagNestingDepth` is therefore a mandatory pre-check *before*
 * `cheerio.load` ever runs, not a nice-to-have — reject anything deeper
 * than a real page plausibly needs. 1,000 was benchmarked at ~8ms (see the
 * same measurement above), several orders of magnitude of headroom over
 * any real recipe page (which nests a few dozen levels at most) while
 * keeping the worst case that does reach `cheerio.load` fast.
 */
const MAX_HTML_NESTING_DEPTH = 1_000;

/**
 * HTML5 void elements — never followed by a closing tag in real markup
 * (`<meta name="x" content="y">`, not `<meta ...></meta>`), and, unlike
 * XHTML, real-world pages essentially never self-close them with a
 * trailing `/>` either. `countMaxTagNestingDepth`'s first version treated
 * any un-self-closed tag as "open, awaiting a close" — `code-reviewer`
 * caught that this makes it count these as ever-growing nesting depth
 * instead of true DOM depth, and confirmed a synthetic but entirely
 * ordinary page shape (dozens of `<meta>`/`<link>` tags plus a few hundred
 * `<img>`s — a normal WordPress food blog with SEO tags, ad/tracking
 * pixels, and a thumbnail grid) measured over 500 "deep" by the old logic
 * despite true nesting never exceeding ~40. Excluding these by name is
 * what makes the heuristic actually track nesting depth rather than tag
 * count.
 */
const VOID_ELEMENT_NAMES = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * A cheap, non-parsing heuristic scan for HTML tag nesting depth — not a
 * real HTML parser, which is fine: it must stay cheap enough to run
 * unconditionally ahead of every `cheerio.load` call, and any remaining
 * imprecision only needs to lean conservative (overcount), never permissive
 * (undercount past a real attack). The regex itself (`<\/?[a-zA-Z][^>]*>`)
 * has no nested/overlapping quantifiers, so it cannot itself become a
 * ReDoS vector on adversarial input.
 */
const countMaxTagNestingDepth = (html: string): number => {
  let depth = 0;
  let maxDepth = 0;
  for (const tag of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    const tagName = tag[1]!.toLowerCase();
    if (tag[0].startsWith('</')) {
      depth = Math.max(0, depth - 1);
    } else if (!tag[0].endsWith('/>') && !VOID_ELEMENT_NAMES.has(tagName)) {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  return maxDepth;
};

/**
 * Escapes raised control characters (0x00-0x1F) found *inside* a JSON
 * string literal. Real published JSON-LD is not always strict JSON: several
 * of S1's own fixtures (`hebbarskitchen`, `sanjeevkapoor`, `spiceupthecurry`
 * — E2E_MVP_PLAN.md §13.5.12) embed literal raw newlines inside string
 * values, which every browser and every real-world JSON-LD consumer
 * tolerates but `JSON.parse` rejects outright ("Bad control character in
 * string literal"). This is a narrow, hand-written repair for exactly that
 * one well-understood defect class — not a general JSON5/relaxed-grammar
 * parser, since nothing broader than this was observed during S1's spike,
 * and pulling in a permissive-JSON dependency for one specific behaviour we
 * can precisely scope and test is the wrong trade. Characters outside a
 * string are left untouched so valid JSON structure is never altered.
 */
const sanitizeControlCharsInStrings = (text: string): string => {
  const CONTROL_CHAR_ESCAPES: Record<string, string> = {
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\b': '\\b',
    '\f': '\\f',
  };

  let result = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      result += ch;
      continue;
    }
    if (escaped) {
      result += ch;
      escaped = false;
    } else if (ch === '\\') {
      result += ch;
      escaped = true;
    } else if (ch === '"') {
      inString = false;
      result += ch;
    } else if (ch.charCodeAt(0) < 0x20) {
      result += CONTROL_CHAR_ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else {
      result += ch;
    }
  }
  return result;
};

/**
 * Extracts every `<script type="application/ld+json">` block's parsed JSON
 * from a page's raw HTML. Uses `cheerio` (Research & Reuse, §2.2: a
 * maintained, widely-used HTML parser) rather than a hand-rolled regex over
 * `<script>...</script>` — arbitrary third-party HTML is hostile input, and
 * a regex extractor breaks on nested quotes, comments, and malformed markup
 * in ways a real parser does not.
 *
 * A block that still fails to parse after control-character sanitisation
 * (malformed JSON unrelated to that specific defect) is skipped, not
 * thrown — one bad `<script>` tag on a page must not prevent every other
 * block, including a later one that may hold the real `Recipe` node, from
 * being read. A page with no matching `<script>` tags at all, one deeper
 * than `MAX_HTML_NESTING_DEPTH`, or one `cheerio.load` itself fails on for
 * any other reason, all return an empty array — never throws, the
 * documented contract every caller (ultimately `normalise.ts`'s
 * `parseJsonLdRecipe`) relies on.
 */
export const extractJsonLdBlocks = (html: string): unknown[] => {
  if (countMaxTagNestingDepth(html) > MAX_HTML_NESTING_DEPTH) {
    return [];
  }

  try {
    const $ = cheerio.load(html);
    const blocks: unknown[] = [];
    $('script[type="application/ld+json"]').each((_index, element) => {
      const raw = $(element).text();
      if (raw.length > MAX_JSON_LD_BLOCK_LENGTH) {
        return;
      }
      try {
        blocks.push(JSON.parse(sanitizeControlCharsInStrings(raw)));
      } catch {
        // Skip — see doc comment above.
      }
    });
    return blocks;
  } catch {
    // cheerio/parse5 is designed to be maximally permissive and was not
    // observed to throw during review, but nothing in its public API
    // guarantees that across versions or unusual encodings — this
    // module's "never throws" contract must hold regardless.
    return [];
  }
};
