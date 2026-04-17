/**
 * Debug endpoint — shows every chunk ranked for a given query.
 * GET /api/admin/compliance-debug?q=<requirement text>&format=html
 * Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateEmbedding } from '@/lib/ai';
import { listChunkSearchRecordsWithDoc } from '@/lib/db';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function scoreColor(s: number) {
  if (s >= 0.65) return '#065F46';
  if (s >= 0.45) return '#92400E';
  if (s >= 0.25) return '#991B1B';
  return '#6B7280';
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query  = req.nextUrl.searchParams.get('q')?.trim();
  const format = req.nextUrl.searchParams.get('format') ?? 'json';

  if (!query) return NextResponse.json({ error: 'Missing ?q= parameter' }, { status: 400 });

  const embedding = await generateEmbedding(query);
  const chunks    = await listChunkSearchRecordsWithDoc();

  const scored = chunks
    .filter(c => c.embedding)
    .map(c => {
      try {
        const emb   = JSON.parse(c.embedding!) as number[];
        const score = cosineSimilarity(embedding, emb);
        return {
          rank:        0,
          score:       parseFloat(score.toFixed(4)),
          document:    c.name,
          chunk_index: c.chunk_index,
          content:     c.content,
          preview:     c.content.slice(0, 300).replace(/\s+/g, ' '),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .map((c, i) => ({ ...c!, rank: i + 1 }));

  if (format === 'html') {
    const rows = scored.slice(0, 30).map(c => {
      const color = scoreColor(c.score);
      const highlight = c.rank <= 15
        ? 'background:#f0fdf4'
        : 'background:#fff7ed';
      return `<tr style="${highlight}">
        <td style="padding:6px 10px;font-weight:700;text-align:center">${c.rank}</td>
        <td style="padding:6px 10px;font-weight:700;color:${color}">${c.score}</td>
        <td style="padding:6px 10px;font-weight:600">${escHtml(c.document)}</td>
        <td style="padding:6px 10px;text-align:center">${c.chunk_index + 1}</td>
        <td style="padding:6px 10px;font-size:11px;color:#374151;max-width:500px;word-break:break-word">${escHtml(c.preview)}…</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Compliance Debug</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 24px; color: #111; }
    h2 { margin: 0 0 4px }
    p  { margin: 0 0 16px; color: #6b7280 }
    table { border-collapse: collapse; width: 100%; font-size: 13px }
    th { background: #1D3461; color: #fff; padding: 8px 10px; text-align: left }
    tr:hover td { background: #eff6ff !important }
    td { border-bottom: 1px solid #e5e7eb }
    .legend { display:flex; gap:16px; font-size:12px; margin-bottom:12px }
    .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:4px }
  </style>
</head>
<body>
  <h2>Compliance Debug — Top 30 chunks</h2>
  <p>Query: <strong>${escHtml(query)}</strong> &nbsp;·&nbsp; Total indexed chunks: ${scored.length}</p>
  <div class="legend">
    <span><span class="dot" style="background:#065F46"></span>≥0.65 strong</span>
    <span><span class="dot" style="background:#92400E"></span>≥0.45 moderate</span>
    <span><span class="dot" style="background:#991B1B"></span>≥0.25 weak</span>
    <span><span class="dot" style="background:#6B7280"></span>&lt;0.25 noise</span>
    <span style="color:#059669">Green rows = inside retrieval window (rank ≤15)</span>
    <span style="color:#D97706">Orange rows = currently excluded (rank &gt;15)</span>
  </div>
  <table>
    <thead><tr>
      <th style="width:44px">Rank</th>
      <th style="width:64px">Score</th>
      <th>Document</th>
      <th style="width:60px">Chunk #</th>
      <th>Content preview</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Default: JSON
  return NextResponse.json({
    query,
    total_chunks: scored.length,
    top_30: scored.slice(0, 30).map(({ content: _, ...rest }) => rest),
  });
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
