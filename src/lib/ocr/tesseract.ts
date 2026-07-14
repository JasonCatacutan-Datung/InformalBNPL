import "server-only";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * OCR via tesseract.js (free, self-hosted — no API key). Runs server-side only,
 * triggered by operator actions (never on the buyer's device or in the submit
 * hot path).
 *
 * Images are preprocessed with sharp before recognition (grayscale, EXIF
 * auto-rotate, upscale, contrast-normalize) so noisy phone photos read better.
 * Preprocessing is best-effort: if it throws we fall back to the original buffer
 * so OCR never hard-fails.
 *
 * The language models are shipped LOCALLY (via the @tesseract.js-data/eng and
 * @tesseract.js-data/fil dependencies) and pointed at with `langPath`, so OCR
 * never does a runtime CDN fetch — that fetch fails with a 403/timeout in
 * serverless / egress-restricted environments and was the cause of "OCR failed:
 * Network error while fetching … eng.traineddata.gz". `fil` (Filipino) is read
 * alongside `eng` so Tagalog fields on PH IDs (e.g. "Pambansang
 * Pagkakakilanlan", "Pasaporte") are picked up. next.config force-includes the
 * data + core in the bundle.
 *
 * Returns a typed result so the operator sees *why* OCR failed instead of a
 * blank "unavailable" — OCR is always best-effort and never blocks a decision.
 */
export type OcrResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const require = createRequire(import.meta.url);

// Languages to recognize, in priority order. eng is always shipped; fil is
// best-effort (its data package may be absent in some builds).
const OCR_LANGS = ["eng", "fil"] as const;

/**
 * Locate the local `<lang>.traineddata.gz` for a bundled @tesseract.js-data
 * package, or null. Tries a few anchors because `require.resolve` of the
 * package's package.json can fail in a bundled/traced serverless build even when
 * the data folder is shipped, and scans immediate subdirs so we don't hard-code
 * the exact version folder name.
 */
function findTraineddata(lang: string): string | null {
  const file = `${lang}.traineddata.gz`;
  const bases: string[] = [];
  try {
    bases.push(
      path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)),
    );
  } catch {
    /* package.json not resolvable in this bundle — try cwd-anchored paths */
  }
  bases.push(
    path.join(process.cwd(), "node_modules", "@tesseract.js-data", lang),
  );

  for (const base of bases) {
    // Known layout first (fast path), then any immediate subdir.
    const direct = path.join(base, "4.0.0_best_int", file);
    try {
      if (fs.existsSync(direct)) return direct;
    } catch {
      /* keep trying */
    }
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = path.join(base, entry.name, file);
        if (fs.existsSync(p)) return p;
      }
    } catch {
      /* base missing — try the next anchor */
    }
  }
  return null;
}

/**
 * Stage every available language's traineddata into a single writable tmp dir
 * and return that as `langPath` (tesseract.js resolves one dir per worker, so
 * eng + fil must live together). Returns only the languages actually present so
 * we never ask the worker for data it can't find. If nothing local is found we
 * return no langPath and eng only, letting tesseract.js fall back to its default
 * path rather than crashing.
 */
function prepareLangData(): { langs: string[]; langPath: string | null } {
  const dest = path.join(os.tmpdir(), "datung-tessdata");
  const available: string[] = [];
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch {
    /* fall through — copies below will just fail and we degrade gracefully */
  }
  for (const lang of OCR_LANGS) {
    const target = path.join(dest, `${lang}.traineddata.gz`);
    try {
      if (fs.existsSync(target)) {
        available.push(lang);
        continue;
      }
      const src = findTraineddata(lang);
      if (src) {
        fs.copyFileSync(src, target);
        available.push(lang);
      }
    } catch {
      /* skip this language — best-effort */
    }
  }
  if (available.length > 0) return { langs: available, langPath: dest };
  return { langs: ["eng"], langPath: null };
}

/**
 * Preprocess an ID/document image for OCR with sharp: EXIF auto-rotate,
 * grayscale, upscale small images, and contrast-normalize. Best-effort — any
 * failure returns the original buffer so OCR still runs (Tesseract applies its
 * own Otsu thresholding internally, so a clean normalized grayscale is what it
 * wants).
 */
async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    // failOn: "none" keeps slightly-truncated phone uploads from throwing.
    const img = sharp(buffer, { failOn: "none" }).rotate(); // auto-orient via EXIF
    const meta = await img.metadata();

    let pipeline = img.grayscale().normalize();
    // Upscale small crops so glyphs are large enough for Tesseract.
    const width = meta.width ?? 0;
    const MIN_WIDTH = 1000;
    if (width > 0 && width < MIN_WIDTH) {
      pipeline = pipeline.resize({ width: MIN_WIDTH });
    }
    return await pipeline.sharpen().png().toBuffer();
  } catch (e) {
    console.error(
      "ocr preprocess failed, using original image:",
      e instanceof Error ? e.message : e,
    );
    return buffer;
  }
}

export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  try {
    // Imported lazily so the (heavy) worker only loads when OCR is actually run.
    const { createWorker } = await import("tesseract.js");
    const input = await preprocessForOcr(buffer);
    // cachePath must be writable (serverless app root is read-only — only /tmp).
    // langPath points at the bundled model(s) so there's no CDN download; if it
    // can't be located we omit it and let tesseract.js use its own default.
    const { langs, langPath } = prepareLangData();
    const worker = await createWorker(langs, 1, {
      cachePath: os.tmpdir(),
      ...(langPath ? { langPath } : {}),
      gzip: true,
      logger: () => {},
    });
    try {
      const { data } = await worker.recognize(input);
      return { ok: true, text: data.text ?? "" };
    } finally {
      await worker.terminate();
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown OCR error";
    console.error("ocrImage failed:", error);
    return { ok: false, error };
  }
}
