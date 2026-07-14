/**
 * Throwaway OCR smoke test. Exercises the sharp preprocessing + ocrImage path
 * end-to-end WITHOUT Supabase, env vars, or a real ID: it renders sample ID text
 * onto a blank canvas with sharp (SVG → PNG), runs it through `ocrImage` (which
 * preprocesses the image internally), and prints the extracted text.
 *
 * Run:  npm run ocr:smoke
 *   (= node --conditions=react-server --experimental-strip-types scripts/ocr-smoke.ts)
 *
 * The `react-server` export condition resolves the `server-only` marker to a
 * no-op, so the server-only OCR module can be imported from a plain Node script.
 */
import sharp from "sharp";
import { ocrImage } from "../src/lib/ocr/tesseract.ts";

async function main(): Promise<void> {
  const width = 1000;
  const height = 640;
  // Sample PH-ID wording incl. Tagalog labels, so the `fil` model has something
  // to read. No real ID data — these are placeholder numbers.
  const font = "DejaVu Sans, Arial, sans-serif";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="white"/>
    <text x="40" y="90"  font-family="${font}" font-size="34" fill="black">Republika ng Pilipinas</text>
    <text x="40" y="150" font-family="${font}" font-size="40" fill="black">Pambansang Pagkakakilanlan</text>
    <text x="40" y="220" font-family="${font}" font-size="30" fill="black">PhilSys Card Number (PCN)</text>
    <text x="40" y="290" font-family="${font}" font-size="46" fill="black">1234 5678 9012 3456</text>
    <text x="40" y="370" font-family="${font}" font-size="34" fill="black">JUAN DELA CRUZ</text>
    <text x="40" y="440" font-family="${font}" font-size="30" fill="black">Pasaporte / Passport P1234567A</text>
  </svg>`;

  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  console.log(
    `Generated synthetic ID image: ${image.length} bytes (${width}x${height}).`,
  );

  const result = await ocrImage(image);
  if (!result.ok) {
    console.error("OCR failed:", result.error);
    process.exit(1);
  }

  console.log("\n--- Extracted text ---");
  console.log(result.text.trim() || "(no text extracted)");
  console.log("--- end ---");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
