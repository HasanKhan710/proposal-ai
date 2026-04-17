
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { generateEmbedding } from '../src/lib/ai';

// Load env
function loadEnv(path: string) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignore */ }
}
loadEnv('.env.local');

const db = createClient({
  url: process.env.DATABASE_URL || 'file:proposal-ai.sqlite',
});

// Pure JS cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Re-implementing the extraction logic specifically for this diagnosis
async function extractRows(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  // WAPOL specific columns (derived from previous knowledge)
  // Col 0: ID (NF.1, F.1 etc)
  // Col 1: Description (The text we need!)
  // Col 2: Compliance (Yes - Fully etc)
  
  return rawRows.map(row => {
    const id = String(row[0] || '').trim();
    const desc = String(row[1] || '').trim();
    const compliance = String(row[2] || '').trim();
    
    // This matches the "searchText" enrichment logic
    const searchText = `${id} ${desc}\n${compliance}`;
    const content = `[Req: ${id}]\n[Compliance: ${compliance}]\n${compliance}`;
    
    return { id, desc, compliance, searchText, content };
  });
}

async function main() {
  const docId = 'fc3e50f0-b649-476d-af4e-1eea71ce2cfb';
  const filePath = "C:\\Users\\Hasan Khan\\.gemini\\antigravity\\scratch\\proposal-ai\\uploads\\proposals\\ed65f9b1-56ab-478d-9f4e-1feebd04e2f5-WAPOL16324_-_Attachment_1_-_Functional_and_Non_Functional_Requirements.xlsx";

  console.log('--- DATABASE STATE ---');
  const { rows } = await db.execute({
    sql: 'SELECT chunk_index, content, embedding FROM chunks WHERE document_id = ? AND (content LIKE "%NF.7%" OR content LIKE "%F.1%")',
    args: [docId]
  });

  for (const r of rows as any) {
    console.log(`\n[DB Chunk #${r.chunk_index}]`);
    console.log(`Stored content:\n${r.content}`);
    
    if (r.content.includes('NF.7')) {
      const query = "multi-factor authentication MFA all users administrators";
      console.log(`\n--- SIMILARITY TEST (NF.7) ---`);
      console.log(`Query: "${query}"`);
      
      try {
        const queryEmb = await generateEmbedding(query);
        const chunkEmb = JSON.parse(r.embedding);
        const score = cosineSimilarity(queryEmb, chunkEmb);
        console.log(`Stored Embedding Cosine Similarity: ${score.toFixed(4)}`);
      } catch (e: any) {
        console.error('Error calculating similarity:', e.message);
      }
    }
  }

  console.log('\n--- LIVE FILE PARSE ---');
  try {
    const buffer = readFileSync(filePath);
    const rows = await extractRows(buffer);
    
    const nf7 = rows.find(r => r.id === 'NF.7');
    const f1 = rows.find(r => r.id === 'F.1');

    if (nf7) {
      console.log('\nNF.7 LIVE:');
      console.log(`Description found: "${nf7.desc}"`);
      console.log(`Generated embedText: "${nf7.searchText}"`);
    } else {
      console.log('\nNF.7 not found in Excel!');
    }

    if (f1) {
      console.log('\nF.1 LIVE:');
      console.log(`Description found: "${f1.desc}"`);
      console.log(`Generated embedText: "${f1.searchText}"`);
    }
  } catch (err: any) {
    console.error('Error reading Excel:', err.message);
  }
}

main().catch(console.error).finally(() => process.exit(0));
