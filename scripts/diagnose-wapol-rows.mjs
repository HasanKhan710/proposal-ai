/**
 * Show raw stored content for all WAPOL chunks, so we can see what's actually
 * in the requirementText, complianceValue, and responseText fields.
 */
import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

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
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

const { rows } = await db.execute(`
  SELECT c.chunk_index, c.content, c.embedding IS NOT NULL as has_emb
  FROM   chunks c
  JOIN   documents d ON c.document_id = d.id
  WHERE  d.name LIKE '%WAPOL%'
  ORDER  BY c.chunk_index
`);

console.log(`Total WAPOL chunks: ${rows.length}\n`);

// Show first 10 and any chunk whose content mentions NF.7, MFA, demand, F.1
const keywords = /\bNF\.7\b|\bMFA\b|multi.factor|demand\s+manag|\bF\.1\b/i;

console.log('── First 15 chunks ─────────────────────────────────────────────');
rows.slice(0, 15).forEach(r => {
  const reqM  = r.content.match(/^\[Req:\s*(.*?)\]/);
  const compM = r.content.match(/\[Compliance:\s*(.*?)\]/);
  const req   = reqM  ? reqM[1].slice(0, 80)  : '(no [Req:] tag)';
  const comp  = compM ? compM[1].slice(0, 30) : '—';
  const body  = r.content.replace(/^\[Req:.*?\]\n?/,'').replace(/^\[Compliance:.*?\]\n?/,'').slice(0, 120);
  console.log(`  #${String(r.chunk_index+1).padStart(3)}  emb=${r.has_emb?'✓':'✗'}  req="${req}"  compliance="${comp}"`);
  console.log(`       body: ${body}`);
  console.log();
});

console.log('── Keyword-matching chunks (NF.7 / MFA / demand / F.1) ─────────');
rows.filter(r => keywords.test(r.content)).forEach(r => {
  const reqM  = r.content.match(/^\[Req:\s*(.*?)\]/);
  const compM = r.content.match(/\[Compliance:\s*(.*?)\]/);
  const req   = reqM  ? reqM[1].slice(0, 100) : '(no [Req:] tag)';
  const comp  = compM ? compM[1].slice(0, 30) : '—';
  const body  = r.content.replace(/^\[Req:.*?\]\n?/,'').replace(/^\[Compliance:.*?\]\n?/,'').slice(0, 200);
  console.log(`  #${String(r.chunk_index+1).padStart(3)}  req="${req}"  compliance="${comp}"`);
  console.log(`       body: ${body}`);
  console.log();
});

process.exit(0);
