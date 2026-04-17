/**
 * Debug: inspect actual stored chunk content for a named document.
 * GET /api/admin/chunk-inspect?doc=Appendix&limit=5
 * Admin-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listChunkSearchRecordsWithDoc } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const docFilter = req.nextUrl.searchParams.get('doc')?.toLowerCase() ?? '';
  const limit     = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '10'), 50);

  const all = await listChunkSearchRecordsWithDoc();
  const filtered = all
    .filter(c => c.name.toLowerCase().includes(docFilter))
    .slice(0, limit);

  const rows = filtered.map(c => ({
    document:    c.name,
    chunk_index: c.chunk_index,
    has_compliance_tag: c.content.includes('[Compliance:'),
    compliance_tag:     (() => {
      const m = c.content.match(/\[Compliance:\s*(.*?)\]/i);
      return m ? `[Compliance: ${m[1]}]` : null;
    })(),
    has_req_tag:     c.content.includes('[Req:'),
    req_tag:         (() => {
      const m = c.content.match(/\[Req:\s*(.*?)\]/i);
      return m ? m[1] : null;
    })(),
    content_preview: c.content.slice(0, 400),
  }));

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Chunk Inspect</title>
<style>
  body{font-family:system-ui,sans-serif;padding:24px;font-size:13px}
  h2{margin:0 0 4px}p{margin:0 0 16px;color:#6b7280}
  table{border-collapse:collapse;width:100%}
  th{background:#1D3461;color:#fff;padding:8px 10px;text-align:left}
  td{border-bottom:1px solid #e5e7eb;padding:8px 10px;vertical-align:top}
  .yes{color:#065F46;font-weight:700}.no{color:#991B1B;font-weight:700}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px}
</style></head><body>
<h2>Chunk Inspector — "${docFilter}"</h2>
<p>Showing ${rows.length} chunks · Filter: ?doc= · Limit: ?limit=</p>
<table>
<thead><tr><th>Document</th><th>Chunk #</th><th>[Req:] tag</th><th>[Compliance:] tag</th><th>Content preview (400 chars)</th></tr></thead>
<tbody>
${rows.map(r => `<tr>
  <td>${r.document}</td>
  <td style="text-align:center">${r.chunk_index + 1}</td>
  <td style="text-align:center">${r.has_req_tag
    ? `<span class="yes">✓ ${r.req_tag}</span>`
    : '<span class="no">✗ missing</span>'}</td>
  <td style="text-align:center">${r.has_compliance_tag
    ? `<span class="yes">✓ ${r.compliance_tag}</span>`
    : '<span class="no">✗ missing</span>'}</td>
  <td><pre>${r.content_preview.replace(/</g,'&lt;')}</pre></td>
</tr>`).join('')}
</tbody></table></body></html>`;

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
