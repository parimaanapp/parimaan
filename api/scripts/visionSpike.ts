import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { callGemini, type GeminiClientDeps, type GeminiImageInput } from '../src/ai/geminiClient.js';

/**
 * W19 S2 — the real, one-off vision-and-compression spike script (D3/D4).
 * Calls the already-shipped `callGemini` multimodal path (S1) directly
 * against a real photo corpus and writes a structured result file for
 * manual/automated scoring. Not a resolver, not rate-limited here, not
 * retried — this is a measurement, not production surface (D3).
 */

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export interface CorpusImage {
  fileName: string;
  filePath: string;
  mimeType: string;
  byteSize: number;
  base64Data: string;
}

/** Reads every supported image file directly under `dir` (non-recursive) — matches how the founder's/friends' photos were exported. */
export const readCorpusImages = (dir: string): CorpusImage[] =>
  readdirSync(dir)
    .filter((name) => MIME_BY_EXT[extname(name).toLowerCase()] !== undefined)
    .sort()
    .map((fileName) => {
      const filePath = join(dir, fileName);
      const buffer = readFileSync(filePath);
      return {
        fileName,
        filePath,
        mimeType: MIME_BY_EXT[extname(fileName).toLowerCase()]!,
        byteSize: buffer.byteLength,
        base64Data: buffer.toString('base64'),
      };
    });

/**
 * The proposed-item shape SD §5.4 names for the future `analyzePantryPhoto`
 * resolver, plus a `confidence` field this spike asks for explicitly so a
 * "guessed from shape, no label visible" item is distinguishable from a
 * "label was legible" one when scoring — SD §5.4 doesn't itself need this
 * field, but a one-time accuracy spike benefits from the model self-reporting it.
 */
export const proposedPantryItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  category: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type ProposedPantryItem = z.infer<typeof proposedPantryItemSchema>;

const proposedPantryItemsSchema = z.array(proposedPantryItemSchema);

export const VISION_PROMPT = `You are looking at a real photo of a home pantry, fridge, or kitchen storage area in an Indian household. It may show shelves, drawers, cabinets, or fridge compartments with packaged groceries, loose produce, or storage jars.

Identify every distinct food/grocery item you can actually see in this photo. For each item, return an object with:
- "name": the specific item name (e.g. "Toor Dal", "Amul Butter", "Carrots") — use the brand name if a label is visible, otherwise a generic descriptive name
- "quantity": your best-effort numeric estimate of the amount visible, or null if you genuinely cannot estimate it (e.g. an opaque container, or no way to judge fill level)
- "unit": one of g, kg, ml, l, piece, packet, jar, bunch, or null if you could not determine quantity
- "category": one of dal, spice, dairy, produce, grain, dry_goods, staple, snack, beverage, condiment, other
- "confidence": "high" if a label was clearly legible and you are confident of the identification, "medium" if you inferred it from visual appearance with reasonable confidence, "low" if it's a guess (partially obscured, no label, ambiguous contents)

Do not invent items you cannot actually see. If a container's contents are not visible at all (fully opaque, or too dark to make out), skip it entirely rather than guessing.

Return ONLY a JSON array of these objects, no prose, no markdown code fences. If you cannot identify anything at all in this photo, return an empty array [].`;

export interface SpikeResult {
  fileName: string;
  byteSize: number;
  durationMs: number;
  promptTokens: number;
  candidateTokens: number;
  rawText?: string;
  items?: ProposedPantryItem[];
  parseError?: string;
  callError?: string;
}

const stripMarkdownFence = (text: string): string => {
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(text.trim());
  return fenced ? fenced[1]!.trim() : text.trim();
};

/** Parses one Gemini raw response into validated proposed items — never throws; a parse failure is recorded, not fatal to the run. */
export const parseVisionResponse = (rawText: string): { items: ProposedPantryItem[] } | { parseError: string } => {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripMarkdownFence(rawText));
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
  const result = proposedPantryItemsSchema.safeParse(parsedJson);
  if (!result.success) {
    return { parseError: result.error.message };
  }
  return { items: result.data };
};

const callOnePhoto = async (image: CorpusImage, deps: GeminiClientDeps): Promise<SpikeResult> => {
  const start = Date.now();
  const geminiImage: GeminiImageInput = { mimeType: image.mimeType, base64Data: image.base64Data };
  try {
    const result = await callGemini(VISION_PROMPT, { timeoutMs: 60_000, images: [geminiImage] }, deps);
    const durationMs = Date.now() - start;
    const parsed = parseVisionResponse(result.rawText);
    return {
      fileName: image.fileName,
      byteSize: image.byteSize,
      durationMs,
      promptTokens: result.usage.promptTokens,
      candidateTokens: result.usage.candidateTokens,
      rawText: result.rawText,
      ...('items' in parsed ? { items: parsed.items } : { parseError: parsed.parseError }),
    };
  } catch (error) {
    return {
      fileName: image.fileName,
      byteSize: image.byteSize,
      durationMs: Date.now() - start,
      promptTokens: 0,
      candidateTokens: 0,
      callError: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Runs the full corpus sequentially (deliberate — avoids bursting Gemini's real rate limits on 59 calls in a row) and writes a JSON results file. */
export const runSpike = async (corpusDir: string, outFile: string, deps: GeminiClientDeps = {}): Promise<SpikeResult[]> => {
  const images = readCorpusImages(corpusDir);
  const results: SpikeResult[] = [];
  for (const [index, image] of images.entries()) {
    process.stderr.write(`[${index + 1}/${images.length}] ${image.fileName} ... `);
    const result = await callOnePhoto(image, deps);
    const status = result.callError ? `ERROR: ${result.callError}` : result.parseError ? `PARSE FAIL: ${result.parseError}` : `${result.items?.length ?? 0} items, ${result.durationMs}ms`;
    process.stderr.write(`${status}\n`);
    results.push(result);
  }
  writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8');
  return results;
};

// This script has exactly one entry point (`node <bundled>.mjs <corpusDir> [outFile]`)
// and nothing else imports it, so it runs unconditionally rather than guarding on an
// argv/import.meta.url comparison that bundling makes unreliable.
const corpusDir = process.argv[2];
const outFile = process.argv[3] ?? 'visionSpikeResults.json';
if (corpusDir === undefined) {
  process.stderr.write('Usage: node visionSpike.mjs <corpusDir> [outFile]\n');
  process.exit(1);
} else {
  runSpike(corpusDir, outFile)
    .then((results) => {
      process.stderr.write(`\nDone. ${results.length} photos processed. Results written to ${outFile}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exit(1);
    });
}
