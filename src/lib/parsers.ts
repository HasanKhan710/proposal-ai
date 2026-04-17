import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { callGemini } from './ai';

// Use require for pdf-parse v1 to avoid ESM/CJS interop issues in Next.js Turbopack
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

// ─── PDF ─────────────────────────────────────────────────────────────────────

export async function parsePdf(buffer: Buffer): Promise<string> {
  console.log(`[Parser] Starting PDF parse. Buffer size: ${buffer.length} bytes`);
  try {
    const data = await pdfParse(buffer);
    const text = data.text || '';
    console.log(`[Parser] PDF parse successful. Extracted text length: ${text.length}`);
    return text;
  } catch (error) {
    console.error('[Parser] Error parsing PDF:', error);
    throw new Error('Failed to parse PDF document.');
  }
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

export async function parseDocx(buffer: Buffer): Promise<string> {
  console.log(`[Parser] Starting DOCX parse. Buffer size: ${buffer.length} bytes`);
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || '';
    console.log(`[Parser] DOCX parse successful. Extracted text length: ${text.length}`);
    return text;
  } catch (error) {
    console.error('[Parser] Error parsing DOCX:', error);
    throw new Error('Failed to parse DOCX document.');
  }
}

// ─── Excel (.xlsx / .xls) ────────────────────────────────────────────────────

export function parseXlsx(buffer: Buffer): string {
  console.log(`[Parser] Starting Excel parse. Buffer size: ${buffer.length} bytes`);
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];

      // Convert sheet to array-of-arrays to handle merged cells and empty rows cleanly
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (rows.length === 0) continue;

      parts.push(`## Sheet: ${sheetName}`);

      for (const row of rows) {
        // Skip completely empty rows
        const rowText = row.map(cell => String(cell ?? '').trim());
        if (rowText.every(c => c === '')) continue;
        parts.push(rowText.join('\t'));
      }

      parts.push(''); // blank line between sheets
    }

    const text = parts.join('\n');
    console.log(`[Parser] Excel parse successful. Extracted text length: ${text.length}`);
    return text;
  } catch (error) {
    console.error('[Parser] Error parsing Excel:', error);
    throw new Error('Failed to parse Excel document.');
  }
}

// ─── Excel KB row extraction ─────────────────────────────────────────────────
//
// When an Excel file is uploaded to the knowledge base it typically contains
// requirement/response pairs. We want to store ONLY the response column as
// chunk content (so retrieved text is clean) but generate the embedding from
// "requirement + response" so the chunk is findable by both angles.
//
// Returns an empty array if no recognisable response column is found (in which
// case the caller should fall back to full-text extraction).

const KB_RESPONSE_KW  = [
  'response', 'comment', 'answer', 'solution', 'deliverable', 'detail',
  'remark', 'note', 'narrative', 'explanation', 'clarification',
  'sdz', 'vendor', 'supplier', 'proposal',   // "SDZ Response", "Vendor Comments" etc.
];
const KB_REQUIRE_KW   = [
  'requirement', 'req', 'feature', 'function', 'item', 'description',
  'criteria', 'specification', 'spec', 'need',
];
// Compliance column header keywords (Phase 1 detection).
const KB_COMPLIANCE_KW = [
  'compliant', 'compliance', 'status', 'conform', 'met', 'rating',
  'fulfil', 'fulfill', 'comply', 'verdict', 'result',
];

// Known compliance value patterns used for Phase 2 (data-value scan).
// If a column's data cells look like these, it's the compliance column regardless of header.
const COMPLIANCE_VALUE_RE = /^(yes|no|partial|full|y|n|p|na|n\/a|tbc|compliant|non-compliant|not compliant|fully compliant|partially compliant|full compliance|partial compliance|meets|does not meet|not met)$/i;

function looksLikeComplianceValue(v: string): boolean {
  const s = v.toLowerCase().trim();
  if (COMPLIANCE_VALUE_RE.test(s)) return true;
  // Short cell (≤25 chars) that contains yes/no/partial as a word
  if (s.length <= 25 && /\b(yes|no|partial|full|compliant)\b/.test(s)) return true;
  return false;
}

export interface XlsxKbRow {
  /** Embedding text: requirement + response (never shown to user). */
  searchText: string;
  /** Stored chunk content: just the clean response text. */
  content: string;
}

// ─── Compliance value normalisation ──────────────────────────────────────────
// Maps raw cell values ("Fully compliant", "Y", "P", etc.) to the canonical
// tags that the Gemini synthesis prompt understands: Yes / Partial / No / NA.

function normalizeComplianceValue(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (/^(yes|y|full(y)?|fully compliant|full compliance|fully met|compliant|meets|met)$/.test(s)) return 'Yes';
  if (/^(partial(ly)?|p|partially compliant|partial compliance|partially met)$/.test(s)) return 'Partial';
  if (/^(no|n|non-?compliant|not compliant|does not meet|not met)$/.test(s)) return 'No';
  if (/^(n\/?a|not applicable|not required)$/.test(s)) return 'NA';
  return raw; // unknown — store as-is so Gemini can still read it
}

// ─── Phase 3: Gemini column detector (fallback) ───────────────────────────────

async function detectColumnsWithGemini(
  headers: string[],
  sampleRows: any[][],
): Promise<{ responseCol: number; complianceCol: number; requirementCol: number }> {
  const none = { responseCol: -1, complianceCol: -1, requirementCol: -1 };
  if (headers.length === 0) return none;

  const headerStr  = headers.map((h, i) => `Col ${i}: "${h}"`).join(' | ');
  const sampleStr  = sampleRows.slice(0, 3).map((row, ri) =>
    `Row ${ri + 1}: [${headers.map((_, ci) => `"${String(row[ci] ?? '').trim().slice(0, 80)}"`).join(', ')}]`,
  ).join('\n');

  const prompt = `You are identifying columns in an Excel spreadsheet.

HEADERS: ${headerStr}
SAMPLE DATA:
${sampleStr}

Return the 0-based column index for each role. Use -1 if not present.
- responseCol: the vendor's written response / explanation (typically the longest text column)
- complianceCol: the compliance verdict (short values like Yes/No/Partial/Y/N/P/Fully compliant/etc.)
- requirementCol: the client requirement or feature description

Return ONLY valid JSON, no markdown:
{"responseCol":<int>,"complianceCol":<int>,"requirementCol":<int>}`;

  try {
    const raw    = await callGemini(prompt);
    const json   = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(json);
    return {
      responseCol:    Number.isInteger(parsed.responseCol)    ? parsed.responseCol    : -1,
      complianceCol:  Number.isInteger(parsed.complianceCol)  ? parsed.complianceCol  : -1,
      requirementCol: Number.isInteger(parsed.requirementCol) ? parsed.requirementCol : -1,
    };
  } catch (err) {
    console.warn('[Parser] Gemini column detection failed:', err);
    return none;
  }
}

export async function extractXlsxKbRows(buffer: Buffer): Promise<XlsxKbRow[]> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const result: XlsxKbRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1, defval: '', blankrows: false,
    });

    if (rawRows.length < 2) continue;

    // ── Locate header row and identify columns ────────────────────────────────
    let headerRowIdx     = -1;
    let reqColIdx        = -1;
    let responseColIdx   = -1;
    let complianceColIdx = -1;

    // Phase 1: scan headers for keyword matches
    for (let ri = 0; ri < Math.min(15, rawRows.length); ri++) {
      const row = rawRows[ri];
      let foundResp = false;

      for (let ci = 0; ci < row.length; ci++) {
        const cell = String(row[ci]).toLowerCase().trim();
        if (reqColIdx === -1 && KB_REQUIRE_KW.some(kw => cell.includes(kw))) {
          reqColIdx = ci;
        }
        if (!foundResp && KB_RESPONSE_KW.some(kw => cell.includes(kw))) {
          responseColIdx = ci;
          foundResp      = true;
        }
        // Accept compliance header if it starts with a compliance keyword (any length),
        // OR is a short cell that contains one — this catches both "Compliance" and
        // "Compliance (please indicate a response using the dropdown)".
        const startsWithComplianceKw = KB_COMPLIANCE_KW.some(kw => cell.startsWith(kw));
        if (complianceColIdx === -1
            && (startsWithComplianceKw || (cell.length < 30 && KB_COMPLIANCE_KW.some(kw => cell.includes(kw))))
        ) {
          complianceColIdx = ci;
        }
      }

      // If the response column and compliance column resolved to the same column
      // (e.g. a header like "Compliance (please indicate a response...)" matched
      // both keyword lists), clear the response assignment so Phase 2/3 can find
      // the real narrative response column.
      if (responseColIdx !== -1 && responseColIdx === complianceColIdx) {
        responseColIdx = -1;
        foundResp      = false;
      }

      if (responseColIdx !== -1) {
        headerRowIdx = ri;
        break;
      }
    }

    // Phase 2: if compliance column wasn't found via header keywords, scan DATA
    // VALUES in the first 10 data rows. A column where ≥60 % of non-empty cells
    // look like compliance statuses (Yes / No / Partial / etc.) is the one.
    if (complianceColIdx === -1) {
      const sampleRows = rawRows.slice(
        headerRowIdx + 1,
        Math.min(headerRowIdx + 11, rawRows.length),
      );
      const colCount = rawRows[headerRowIdx]?.length ?? 0;

      let bestCol   = -1;
      let bestRatio = 0;

      for (let ci = 0; ci < colCount; ci++) {
        if (ci === responseColIdx || ci === reqColIdx) continue;

        const vals = sampleRows
          .map(r => String(r[ci] ?? '').trim())
          .filter(v => v.length > 0);

        if (vals.length === 0) continue;

        const hits  = vals.filter(looksLikeComplianceValue).length;
        const ratio = hits / vals.length;

        if (ratio >= 0.6 && ratio > bestRatio) {
          bestRatio = ratio;
          bestCol   = ci;
        }
      }

      complianceColIdx = bestCol;
      if (complianceColIdx !== -1) {
        console.log(`[Parser] Compliance column detected via data-value scan at col ${complianceColIdx} (${(bestRatio * 100).toFixed(0)}% match)`);
      }
    }

    // Phase 3: Gemini fallback — fires when keyword + data-value scans are insufficient
    if (responseColIdx === -1 || complianceColIdx === -1) {
      const hIdx      = headerRowIdx !== -1 ? headerRowIdx : 0;
      const headers   = (rawRows[hIdx] ?? []).map(c => String(c).trim());
      const sampleData = rawRows.slice(hIdx + 1, hIdx + 4);
      console.log(`[Parser] Phase 3: calling Gemini for column detection on sheet "${sheetName}"`);
      const detected = await detectColumnsWithGemini(headers, sampleData);

      if (responseColIdx === -1 && detected.responseCol >= 0) {
        responseColIdx = detected.responseCol;
        headerRowIdx   = hIdx;
        console.log(`[Parser] Gemini detected response col: ${responseColIdx}`);
      }
      if (complianceColIdx === -1 && detected.complianceCol >= 0) {
        complianceColIdx = detected.complianceCol;
        console.log(`[Parser] Gemini detected compliance col: ${complianceColIdx}`);
      }
      if (reqColIdx === -1 && detected.requirementCol >= 0) {
        reqColIdx = detected.requirementCol;
      }
    }

    if (responseColIdx === -1) continue; // still undetectable — fall back to full-text

    // Log final column detection result for every sheet so uploads are diagnosable
    const headerRow = rawRows[headerRowIdx] ?? [];
    console.log(
      `[Parser] Sheet "${sheetName}" — ` +
      `reqCol=${reqColIdx}(${headerRow[reqColIdx] ?? '?'}) ` +
      `complianceCol=${complianceColIdx}(${headerRow[complianceColIdx] ?? 'not found'}) ` +
      `responseCol=${responseColIdx}(${headerRow[responseColIdx] ?? '?'})`,
    );

    // ── Extract one row per data row ──────────────────────────────────────────
    for (let ri = headerRowIdx + 1; ri < rawRows.length; ri++) {
      const responseText = String(rawRows[ri][responseColIdx] ?? '').trim();
      if (responseText.length < 10) continue;

      const requirementText = reqColIdx !== -1
        ? String(rawRows[ri][reqColIdx] ?? '').trim()
        : '';

      // Build structured content prefix so Gemini can see both the original KB
      // requirement context and the compliance verdict alongside the response text.
      const rawCompliance = complianceColIdx !== -1
        ? String(rawRows[ri][complianceColIdx] ?? '').trim()
        : '';
      const complianceValue = rawCompliance ? normalizeComplianceValue(rawCompliance) : '';

      // Skip preamble / legend rows: a compliance column was detected but this row
      // carries no compliance verdict — it's a header, key, or definition row, not
      // an actual requirement response.
      if (complianceColIdx !== -1 && !complianceValue) continue;

      const parts: string[] = [];
      if (requirementText) parts.push(`[Req: ${requirementText}]`);
      if (complianceValue)  parts.push(`[Compliance: ${complianceValue}]`);
      parts.push(responseText);
      const content = parts.join('\n');

      // ── Build searchText for embedding ─────────────────────────────────────
      // Goal: the embedding must be semantically rich so it matches natural-
      // language queries even when the stored content is sparse.
      //
      // Problem pattern: files like WAPOL have a structure where
      //   requirementText = short ID ("NF.7")
      //   responseText    = just the compliance verdict ("Yes - Fully")
      //   actual description = a separate column not yet assigned to any role
      //
      // Solution: collect all "medium-length" cells in the row (20-500 chars)
      // that are NOT already mapped to req/compliance/response columns — these
      // are description / narrative / comment columns.  Always include them in
      // the search text so the embedding is anchored to real semantic content.

      const enrichmentCells = (rawRows[ri] as unknown[])
        .map((c, ci) => ({ val: String(c ?? '').trim(), ci }))
        .filter(({ val, ci }) =>
          val.length >= 20 &&
          val.length <= 500 &&
          ci !== responseColIdx &&
          ci !== complianceColIdx &&
          ci !== reqColIdx,
        )
        .map(({ val }) => val);

      // If responseText is just a compliance word (≤ 30 chars, starts with yes/
      // no/partial/fully), it carries no searchable meaning — exclude it from the
      // search text and rely on the enrichment cells instead.
      const responseIsJustVerdict =
        responseText.length <= 30 &&
        /^(yes|no|partial|fully|y |n |p |compliant|not |does not)/i.test(responseText);

      const searchParts: string[] = [];
      if (requirementText) searchParts.push(requirementText);
      if (!responseIsJustVerdict) searchParts.push(responseText);
      searchParts.push(...enrichmentCells);
      // Fallback: if we still have nothing useful, at least embed the verdict
      if (searchParts.length === 0) searchParts.push(responseText);

      const searchText = searchParts.join('\n');

      result.push({ searchText, content });
    }
  }

  return result;
}

// ─── PowerPoint (.pptx) ──────────────────────────────────────────────────────
// PPTX files are ZIP archives. Each slide is an XML file under ppt/slides/.
// Text lives in <a:t> elements. We also extract speaker notes from
// ppt/notesSlides/ so that context-rich notes are available for RAG.

export async function parsePptx(buffer: Buffer): Promise<string> {
  console.log(`[Parser] Starting PPTX parse. Buffer size: ${buffer.length} bytes`);
  try {
    const zip = await JSZip.loadAsync(buffer);
    const parts: string[] = [];

    // Collect and sort slide files so slides are in order
    const slideEntries = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)![0]);
        const numB = parseInt(b.match(/\d+/)![0]);
        return numA - numB;
      });

    for (let idx = 0; idx < slideEntries.length; idx++) {
      const slideNum = idx + 1;
      const xml = await zip.files[slideEntries[idx]].async('string');

      // Extract all text runs from the slide XML
      const slideTexts = extractXmlText(xml);
      if (slideTexts.length === 0) continue;

      parts.push(`## Slide ${slideNum}`);
      parts.push(slideTexts.join('\n'));

      // Try to include speaker notes for this slide
      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
      if (zip.files[notesPath]) {
        const notesXml = await zip.files[notesPath].async('string');
        const noteTexts = extractXmlText(notesXml).filter(t => t.trim());
        if (noteTexts.length > 0) {
          parts.push(`Notes: ${noteTexts.join(' ')}`);
        }
      }

      parts.push(''); // blank line between slides
    }

    const text = parts.join('\n');
    console.log(`[Parser] PPTX parse successful. ${slideEntries.length} slides, text length: ${text.length}`);
    return text;
  } catch (error) {
    console.error('[Parser] Error parsing PPTX:', error);
    throw new Error('Failed to parse PowerPoint document.');
  }
}

/**
 * Extract all <a:t> text node values from OOXML, preserving paragraph breaks.
 * Paragraphs (<a:p>) become separate strings; runs within a paragraph are joined.
 */
function extractXmlText(xml: string): string[] {
  const results: string[] = [];

  // Split by paragraph tags first
  const paragraphs = xml.split(/<a:p[ >]/);
  for (const para of paragraphs) {
    // Extract all text runs within this paragraph
    const runs: string[] = [];
    const textRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g;
    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(para)) !== null) {
      const decoded = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
      if (decoded) runs.push(decoded);
    }
    if (runs.length > 0) results.push(runs.join(' '));
  }

  return results;
}

// ─── File type detection ──────────────────────────────────────────────────────

export type SupportedFileType = 'pdf' | 'docx' | 'xlsx' | 'pptx';

export function detectFileType(mimeType: string, filename: string): SupportedFileType | null {
  const name = filename.toLowerCase();

  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) return 'docx';

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel' ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls')
  ) return 'xlsx';

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mimeType === 'application/vnd.ms-powerpoint' ||
    name.endsWith('.pptx') ||
    name.endsWith('.ppt')
  ) return 'pptx';

  return null;
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const fileType = detectFileType(mimeType, filename);

  switch (fileType) {
    case 'pdf':  return parsePdf(buffer);
    case 'docx': return parseDocx(buffer);
    case 'xlsx': return parseXlsx(buffer);
    case 'pptx': return parsePptx(buffer);
    default:
      throw new Error(
        `Unsupported file type. Please upload a PDF, DOCX, Excel (.xlsx), or PowerPoint (.pptx) file.`,
      );
  }
}
