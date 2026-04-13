import * as mammoth from 'mammoth';

// Use require for pdf-parse v1 to avoid ESM/CJS interop issues in Next.js Turbopack
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

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

export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    return parsePdf(buffer);
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    filename.toLowerCase().endsWith('.docx')
  ) {
    return parseDocx(buffer);
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
}
