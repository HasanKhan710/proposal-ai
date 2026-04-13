import { getSession } from '@/lib/auth';
import { getSetting, setSetting } from '@/lib/db';
import { DEFAULT_STYLE, DocStyleConfig } from '@/lib/export';
import { localTemplateExists, removeStoredFile, saveMasterTemplate } from '@/lib/storage';

// JSZip is hoisted into node_modules as a transitive dependency of mammoth
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as any;

// ── Style extraction from styles.xml ─────────────────────────────────────────

function extractAttr(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\s[^>]*${attr}="([^"]+)"`, 'i');
  return xml.match(re)?.[1] ?? null;
}

function parseStyleBlock(block: string): Partial<DocStyleConfig> {
  const result: Partial<DocStyleConfig> = {};

  // Font — prefer ascii face
  const font =
    extractAttr(block, 'w:rFonts', 'w:ascii') ??
    extractAttr(block, 'w:rFonts', 'w:hAnsi');
  if (font) result.bodyFont = font;   // overwritten per-level below

  // Size (half-points)
  const sizeMatch = block.match(/<w:sz\s+w:val="(\d+)"/);
  if (sizeMatch) result.bodySize = parseInt(sizeMatch[1]);

  // Color
  const colorMatch = block.match(/<w:color\s+w:val="([A-Fa-f0-9]{6})"/i);
  if (colorMatch) result.h1Color = colorMatch[1];  // overwritten per-level

  return result;
}

function extractStylesFromXml(xml: string): DocStyleConfig {
  const config: DocStyleConfig = { ...DEFAULT_STYLE };

  // Extract document-level defaults (Normal style body font/size)
  const normalBlock = xml.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] ?? '';
  if (normalBlock) {
    const font  = extractAttr(normalBlock, 'w:rFonts', 'w:ascii');
    const szM   = normalBlock.match(/<w:sz\s+w:val="(\d+)"/);
    if (font)  { config.bodyFont = font; config.h1Font = font; config.h2Font = font; config.h3Font = font; }
    if (szM)    config.bodySize = parseInt(szM[1]);
  }

  // Iterate over paragraph styles
  const styleRe = /<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g;
  let m: RegExpExecArray | null;

  while ((m = styleRe.exec(xml)) !== null) {
    const id    = m[1];
    const block = m[2];
    const parsed = parseStyleBlock(block);

    const font   = parsed.bodyFont;
    const size   = parsed.bodySize;
    const color  = parsed.h1Color;

    if (id === 'Heading1' || id === 'heading1') {
      if (font)  config.h1Font  = font;
      if (size)  config.h1Size  = size;
      if (color) config.h1Color = color;
    } else if (id === 'Heading2' || id === 'heading2') {
      if (font)  config.h2Font  = font;
      if (size)  config.h2Size  = size;
      if (color) config.h2Color = color;
    } else if (id === 'Heading3' || id === 'heading3') {
      if (font)  config.h3Font  = font;
      if (size)  config.h3Size  = size;
      if (color) config.h3Color = color;
    } else if (id === 'Normal' || id === 'normal') {
      if (font)  { config.bodyFont = font; }
      if (size)  config.bodySize = size;
    }
  }

  // Page margins from document.xml settings (approximate; default 1 inch if not found)
  const marginMatch = xml.match(/w:left="(\d+)"/);
  if (marginMatch) config.pageMargin = parseInt(marginMatch[1]);

  return config;
}

// ── GET — return current template status ─────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const templatePath = await getSetting('template_storage_path');
  const styleJson = await getSetting('template_styles');
  const uploadedAt = await getSetting('template_uploaded_at');
  const hasTemplate = Boolean(templatePath) && (
    process.env.STORAGE_BACKEND === 'blob' ? true : localTemplateExists(templatePath)
  );

  return Response.json({
    hasTemplate,
    uploadedAt,
    styles: styleJson ? JSON.parse(styleJson) : null,
  });
}

// ── POST — upload and process master template ─────────────────────────────────

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file     = formData.get('file') as File | null;

    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.docx')) {
      return Response.json({ error: 'Only .docx files are supported as master templates.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storedTemplatePath = await saveMasterTemplate(buffer);

    // Extract styles.xml using JSZip
    const zip     = await JSZip.loadAsync(buffer);
    const stylesFile = zip.file('word/styles.xml');

    let config: DocStyleConfig = { ...DEFAULT_STYLE };

    if (stylesFile) {
      const xml = await stylesFile.async('string') as string;
      config    = extractStylesFromXml(xml);
    }

    // Persist
    await setSetting('template_storage_path', storedTemplatePath);
    await setSetting('template_styles', JSON.stringify(config));
    await setSetting('template_uploaded_at', new Date().toISOString());

    return Response.json({
      message: `Template "${file.name}" uploaded and styles extracted successfully.`,
      styles: config,
    });

  } catch (err: any) {
    console.error('[Template] Upload error:', err);
    return Response.json({ error: err.message || 'Upload failed.' }, { status: 500 });
  }
}

// ── DELETE — remove master template ──────────────────────────────────────────

export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const templatePath = await getSetting('template_storage_path');
  await removeStoredFile(templatePath);
  await setSetting('template_storage_path', '');
  await setSetting('template_styles', '');
  await setSetting('template_uploaded_at', '');

  return Response.json({ message: 'Master template removed.' });
}
