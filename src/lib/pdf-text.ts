/**
 * PDF text extraction for API routes. Must load the pdf-parse worker once so
 * pdf.js works in Node / Next.js (see pdf-parse README: Worker Configuration).
 */
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export async function extractTextFromPdfBuffer(buffer: ArrayBuffer): Promise<string> {
  const data = new Uint8Array(buffer);
  const pdf = new PDFParse({ data });
  try {
    const result = await pdf.getText();
    return (result.text ?? "").trim();
  } finally {
    await pdf.destroy();
  }
}

/** Browsers often send PDFs as octet-stream or empty MIME — trust extension too */
export function isPdfUpload(file: { name: string; type: string }): boolean {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return true;
  const t = (file.type || "").toLowerCase();
  return (
    t === "application/pdf" ||
    t === "application/x-pdf" ||
    t === "application/acrobat"
  );
}
