/**
 * Diagnose stored embedText and responseText for WAPOL NF.7 and F.1,
 * then live-reparse the original file with the current parsers.ts code.
 * Run: npx tsx scripts/diagnose-wapol-nf7.ts
 */
import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { extractXlsxKbRows } from '../src/lib/parsers';
import { generateEmbedding } from '../src/lib/ai';

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignore */ }
}
loadEnv('.env.local');

const db = createClient({ url: process.env.DATABASE_URL || 'file:proposal-ai.sqlite' });

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function main() {
  // ── 1. What's actually stored in the DB right now? ───────────────────────
  console.log('══ STORED CHUNKS (current DB) ══════════════════════════════════\n');

  const { rows } = await db.execute(`
    SELECT c.chunk_index, c.content, c.embedding IS NOT NULL AS has_emb
    FROM   chunks c
    JOIN   documents d ON c.document_id = d.id
    WHERE  d.name LIKE '%WAPOL%'
      AND  (c.content LIKE '%NF.7%' OR c.content LIKE '%[Req: F.1]%' OR c.content LIKE '%[Req: F.1 %')
    ORDER  BY c.chunk_index
  `);

  if (rows.length === 0) {
    console.log('No NF.7 or F.1 chunks found in DB — WAPOL may not be uploaded yet.\n');
  }

  for (const r of rows) {
    console.log(`Chunk #${Number(r.chunk_index) + 1}  emb=${r.has_emb ? '✓' : '✗'}`);
    console.log(`Stored content:\n${r.content}\n`);
  }

  // ── 2. Live re-parse the original file with current parsers.ts ───────────
  const filePath = String(process.env.WAPOL_FILE_PATH || '').trim() ||
    'C:\\Users\\Hasan Khan\\.gemini\\antigravity\\scratch\\proposal-ai\\uploads\\proposals\\ed65f9b1-56ab-478d-9f4e-1feebd04e2f5-WAPOL16324_-_Attachment_1_-_Functional_and_Non_Functional_Requirements.xlsx';

  console.log('══ LIVE RE-PARSE (current parsers.ts code) ═════════════════════\n');
  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (err: any) {
    console.error(`Cannot read WAPOL file at: ${filePath}`);
    console.error(err.message);
    console.log('\nSet WAPOL_FILE_PATH env var to the correct path and retry.');
    return;
  }

  const kbRows = await extractXlsxKbRows(buffer);
  console.log(`Total KB rows extracted by current code: ${kbRows.length}\n`);

  const nf7 = kbRows.find(r => r.content.includes('[Req: NF.7]') || r.searchText.startsWith('NF.7'));
  const f1  = kbRows.find(r => r.content.includes('[Req: F.1]')  || r.searchText.startsWith('F.1'));

  for (const [label, row] of [['NF.7', nf7], ['F.1', f1]] as [string, typeof nf7][]) {
    if (!row) {
      console.log(`${label}: NOT FOUND in live re-parse.\n`);
      continue;
    }
    console.log(`── ${label} ──────────────────────────────────────────────`);
    console.log(`searchText (what gets embedded):\n${row.searchText}\n`);
    console.log(`content (what gets stored):\n${row.content}\n`);

    const wordCount = row.searchText.split(/\s+/).filter(Boolean).length;
    const isStillThin = wordCount < 8;
    console.log(`searchText word count: ${wordCount}  ${isStillThin ? '⚠ STILL TOO THIN — fix did not apply' : '✓ rich enough'}\n`);
  }

  // ── 3. Similarity test for NF.7 if it exists ────────────────────────────
  if (nf7) {
    const query = 'multi-factor authentication MFA all users administrators';
    console.log('══ SIMILARITY TEST (NF.7 live searchText vs query) ═════════════\n');
    console.log(`Query: "${query}"`);
    try {
      const [qEmb, rowEmb] = await Promise.all([
        generateEmbedding(query),
        generateEmbedding(nf7.searchText),
      ]);
      const score = cosine(qEmb, rowEmb);
      console.log(`Cosine similarity: ${(score * 100).toFixed(1)}%`);
      console.log(score >= 0.80 ? '✓ Meets >80% target' : `⚠ Below 80% target (${(score*100).toFixed(1)}%) — description column may still not be captured`);
    } catch (err: any) {
      console.error('Embedding error:', err.message);
    }
  }
}

main().catch(console.error).finally(() => process.exit(0));
