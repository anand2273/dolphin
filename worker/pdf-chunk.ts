import { PDFDocument } from "pdf-lib";

/**
 * Structural (page-based) chunking, deliberately not semantic — no LLM call
 * decides where a chunk starts or ends. Fixed-size page windows with a
 * 1-page overlap so a topic whose content straddles a window boundary still
 * appears whole in at least one chunk.
 */
const PAGES_PER_CHUNK = 3;
const PAGE_OVERLAP = 1;

export type PdfChunk = {
  fileBytes: ArrayBuffer;
  /** 1-indexed, inclusive, for the extraction prompt's page-range context. */
  startPage: number;
  endPage: number;
  totalPages: number;
};

export async function chunkPdfByPages(fileBytes: ArrayBuffer): Promise<PdfChunk[]> {
  const source = await PDFDocument.load(fileBytes);
  const totalPages = source.getPageCount();

  const chunks: PdfChunk[] = [];
  const stride = PAGES_PER_CHUNK - PAGE_OVERLAP;
  for (let start = 0; start < totalPages; start += stride) {
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);

    const chunkDoc = await PDFDocument.create();
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);
    const copiedPages = await chunkDoc.copyPages(source, pageIndices);
    copiedPages.forEach((page) => chunkDoc.addPage(page));

    const bytes = await chunkDoc.save();
    chunks.push({
      fileBytes: bytes.slice().buffer,
      startPage: start + 1,
      endPage: end,
      totalPages,
    });

    if (end === totalPages) break;
  }

  return chunks;
}
