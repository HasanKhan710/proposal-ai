
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { extractXlsxKbRows } from '../src/lib/parsers.js'; 
import { generateEmbedding } from '../src/lib/ai.js';

// Load env
function loadEnv(path) {
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
function cosineSimilarity(a, b) {
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

async function main() {
  const docId = 'fc3e50f0-b649-476d-af4e-1eea71ce2cfb';
  const filePath = "C:\\Users\\Hasan Khan\\.gemini\\antigravity\\scratch\\proposal-ai\\uploads\\proposals\\ed65f9b1-56ab-478d-9f4e-1feebd04e2f5-WAPOL16324_-_Attachment_1_-_Functional_and_Non_Functional_Requirements.xlsx";

  console.log('--- Database Check ---');
  const { rows } = await db.execute({
    sql: 'SELECT chunk_index, content, embedding FROM chunks WHERE document_id = ? AND (content LIKE "%NF.7%" OR content LIKE "%F.1%")',
    args: [docId]
  });

  for (const r of rows) {
    console.log(`\nChunk #${r.chunk_index}:`);
    console.log(`Stored Content:\n${r.content}`);
    
    if (r.content.includes('NF.7')) {
      const query = "multi-factor authentication MFA all users administrators";
      console.log(`\n--- Similarity Test (NF.7) ---`);
      console.log(`Query: "${query}"`);
      
      try {
        const queryEmb = await generateEmbedding(query);
        const chunkEmb = JSON.parse(r.embedding);
        const score = cosineSimilarity(queryEmb, chunkEmb);
        console.log(`Cosine Similarity: ${score.toFixed(4)}`);
      } catch (e) {
        console.error('Error calculating similarity:', e.message);
      }
    }
  }

  console.log('\n--- Re-parsing Original File (Live) ---');
  try {
    const buffer = readFileSync(filePath);
    const kbRows = await extractXlsxKbRows(buffer);
    const nf7 = kbRows.find(row => row.searchText.includes('NF.7') || row.content.includes('NF.7'));
    const f1 = kbRows.find(row => row.searchText.includes('F.1') || row.content.includes('F.1'));

    if (nf7) {
      console.log('\nNF.7 LIVE RE-PARSE:');
      console.log(`Expected embedText (searchText):\n${nf7.searchText}`);
      console.log(`Expected content:\n${nf7.content}`);
    } else {
      console.log('\nNF.7 not found in live re-parse.');
    }

    if (f1) {
      console.log('\nF.1 LIVE RE-PARSE:');
      console.log(`Expected embedText (searchText):\n${f1.searchText}`);
      console.log(`Expected content:\n${f1.content}`);
    }
  } catch (err) {
    console.error('Error re-parsing file:', err.message);
  }
}

main().catch(console.error).finally(() => process.exit(0));
