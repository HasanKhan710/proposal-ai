import { getSession } from '@/lib/auth';
import { getSetting } from '@/lib/db';
import { buildDocument, deriveFilename, DEFAULT_STYLE, DocStyleConfig, DocMetadata } from '@/lib/export';
import { Packer } from 'docx';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });

  try {
    const body = await request.json();
    const { markdown, metadata } = body as { markdown: string; metadata?: Partial<DocMetadata> };

    if (!markdown) return new Response('markdown is required', { status: 400 });

    // Load master template styles if available, fall back to defaults
    const styleJson = await getSetting('template_styles');
    const style: DocStyleConfig = styleJson && styleJson !== ''
      ? JSON.parse(styleJson)
      : DEFAULT_STYLE;

    const filename = deriveFilename(markdown);
    const title    = filename.replace(/\.docx$/i, '').replace(/_/g, ' ');
    const doc      = buildDocument(markdown, title, style, metadata ?? {});
    const buffer   = await Packer.toBuffer(doc);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });

  } catch (err: any) {
    console.error('[Export] Error:', err);
    return new Response(`Export failed: ${err.message}`, { status: 500 });
  }
}
