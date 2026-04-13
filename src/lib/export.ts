import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Header,
  Footer,
  AlignmentType,
  ShadingType,
  TabStopType,
  Tab,
  PageNumber,
  SectionType,
} from 'docx';
import { saveAs } from 'file-saver';

// ─── Brand constants ──────────────────────────────────────────────────────────
// IMPORTANT: Always use ShadingType.CLEAR (not SOLID) for fill colors.
// ShadingType.SOLID fills with the FOREGROUND color (color:'auto'=black),
// ignoring the fill property entirely. ShadingType.CLEAR fills with the
// BACKGROUND fill color, which is what we want.
const NAVY       = '1D3461';
const GOLD       = 'B8933F';
const WHITE      = 'FFFFFF';
const GREY       = '64748B';
const GREY_LIGHT = 'F1F5F9';
const GREY_MID   = 'CBD5E1';
const BODY_COLOR = '1E293B';

const CONTENT_WIDTH_TWIPS = 9026;  // A4, 1-inch margins each side
const MARGIN_TWIPS        = 1440;  // 1 inch

// ─── Shading helpers ─────────────────────────────────────────────────────────

/** Fill a cell/paragraph with a solid background color. */
function fillColor(hex: string) {
  return { type: ShadingType.CLEAR, fill: hex, color: 'auto' } as const;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocStyleConfig {
  bodyFont:   string;
  bodySize:   number;
  h1Font:     string;
  h1Size:     number;
  h1Color:    string;
  h2Font:     string;
  h2Size:     number;
  h2Color:    string;
  h3Font:     string;
  h3Size:     number;
  h3Color:    string;
  pageMargin: number;
}

export interface DocMetadata {
  title:           string;
  reference?:      string;
  client?:         string;
  date?:           string;
  preparedBy?:     string;
  classification?: string;
  docType?:        string;
}

export const DEFAULT_STYLE: DocStyleConfig = {
  bodyFont:   'Arial',
  bodySize:   22,
  h1Font:     'Arial',
  h1Size:     36,
  h1Color:    NAVY,
  h2Font:     'Arial',
  h2Size:     28,
  h2Color:    NAVY,
  h3Font:     'Arial',
  h3Size:     24,
  h3Color:    NAVY,
  pageMargin: MARGIN_TWIPS,
};

// ─── Shared border helpers ────────────────────────────────────────────────────

const noBorders = {
  top:              { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom:           { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left:             { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right:            { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
} as const;

// ─── Filename & Metadata ──────────────────────────────────────────────────────

export function deriveFilename(markdown: string, fallback = 'proposal'): string {
  const h1  = markdown.match(/^#\s+(.+)$/m);
  const base = h1
    ? h1[1].replace(/[^\w\s-]/g, '').trim()
    : fallback.replace(/[^\w\s-]/g, '').trim();
  return (base.replace(/\s+/g, '_').slice(0, 60) || 'proposal') + '.docx';
}

export function deriveMetadata(markdown: string, overrides: Partial<DocMetadata> = {}): DocMetadata {
  const h1    = markdown.match(/^#\s+(.+)$/m);
  const title = overrides.title ?? (h1 ? h1[1].trim() : 'Proposal');

  const year  = new Date().getFullYear();
  const rand4 = Math.floor(1000 + Math.random() * 9000);

  const clientMatch = markdown.match(/(?:client|department)[:\s]+([^\n,]+)/i);
  const client      = overrides.client ?? (clientMatch ? clientMatch[1].trim() : 'To Be Confirmed');

  const date = overrides.date ?? new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return {
    title,
    reference:      overrides.reference      ?? `GRV-AI-${year}-${rand4}`,
    client,
    date,
    preparedBy:     overrides.preparedBy     ?? 'GravityONE — Gravity Ellipse Technology',
    docType:        overrides.docType        ?? 'PROPOSAL FOR STRATEGIC SERVICES',
    classification: overrides.classification ?? 'Commercial Confidential',
  };
}

// ─── Inline markdown parser ───────────────────────────────────────────────────

function parseInline(
  text:      string,
  font     = 'Arial',
  size     = 22,
  color    = BODY_COLOR,
  boldBase = false,
): TextRun[] {
  const runs: TextRun[] = [];
  let i = 0;
  const plain = (s: string) => new TextRun({ text: s, font, size, color, bold: boldBase });

  while (i < text.length) {
    const rest = text.slice(i);

    if (rest.startsWith('***')) {
      const close = text.indexOf('***', i + 3);
      if (close !== -1) {
        runs.push(new TextRun({ text: text.slice(i + 3, close), bold: true, italics: true, font, size, color }));
        i = close + 3; continue;
      }
    }
    if (rest.startsWith('**')) {
      const close = text.indexOf('**', i + 2);
      if (close !== -1) {
        runs.push(new TextRun({ text: text.slice(i + 2, close), bold: true, font, size, color }));
        i = close + 2; continue;
      }
    }
    if (rest.startsWith('*') && !rest.startsWith('**')) {
      const close = text.indexOf('*', i + 1);
      if (close !== -1 && close > i + 1) {
        runs.push(new TextRun({ text: text.slice(i + 1, close), italics: true, font, size, color, bold: boldBase }));
        i = close + 1; continue;
      }
    }
    if (rest.startsWith('`')) {
      const close = text.indexOf('`', i + 1);
      if (close !== -1) {
        runs.push(new TextRun({ text: text.slice(i + 1, close), font: 'Courier New', size: 18, color: '1e40af' }));
        i = close + 1; continue;
      }
    }
    if (rest.startsWith('~~')) {
      const close = text.indexOf('~~', i + 2);
      if (close !== -1) {
        runs.push(new TextRun({ text: text.slice(i + 2, close), strike: true, font, size, color }));
        i = close + 2; continue;
      }
    }

    let j = i + 1;
    while (j < text.length && !'*`~'.includes(text[j])) j++;
    runs.push(plain(text.slice(i, j)));
    i = j;
  }

  return runs.length ? runs : [plain(text)];
}

// ─── Cover page ───────────────────────────────────────────────────────────────

function buildCoverPage(meta: DocMetadata): (Paragraph | Table)[] {
  const parts: (Paragraph | Table)[] = [];

  // ── Top header band — navy background, tab stop for right-aligned CONFIDENTIAL
  parts.push(new Paragraph({
    tabStops:  [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_TWIPS }],
    shading:   fillColor(NAVY),
    border:    { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 0 } },
    spacing:   { before: 120, after: 140 },
    children: [
      new TextRun({ text: 'GravityONE', bold: true,  font: 'Arial', size: 19, color: WHITE }),
      new TextRun({ text: `  |  ${meta.docType ?? ''}  —  ${meta.client ?? ''}`, font: 'Arial', size: 19, color: GREY_MID }),
      new Tab(),
      new TextRun({ text: 'CONFIDENTIAL', bold: true, font: 'Arial', size: 17, color: GREY_MID }),
    ],
  }));

  // ── Small gap (navy shaded to avoid white strip)
  parts.push(new Paragraph({
    shading:  fillColor(NAVY),
    spacing:  { before: 0, after: 200 },
    children: [],
  }));

  // ── Main navy box: brand + title + metadata
  const metaRows: [string, string][] = [
    ['Reference:',      meta.reference  ?? ''],
    ['Client:',         meta.client     ?? ''],
    ['Date:',           meta.date       ?? ''],
    ['Prepared By:',    meta.preparedBy ?? ''],
    ['Classification:', meta.classification ?? ''],
  ];

  const metaTable = new Table({
    width:   { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorders,
    rows: metaRows.map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width:   { size: 28, type: WidthType.PERCENTAGE },
            borders: noBorders,
            shading: fillColor(NAVY),
            children: [new Paragraph({
              shading:  fillColor(NAVY),
              spacing:  { before: 60, after: 60 },
              children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true, color: GOLD })],
            })],
          }),
          new TableCell({
            width:   { size: 72, type: WidthType.PERCENTAGE },
            borders: noBorders,
            shading: fillColor(NAVY),
            children: [new Paragraph({
              shading:  fillColor(NAVY),
              spacing:  { before: 60, after: 60 },
              children: [new TextRun({ text: value, font: 'Arial', size: 20, color: WHITE })],
            })],
          }),
        ],
      }),
    ),
  });

  parts.push(new Table({
    width:   { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      ...noBorders,
      bottom: { style: BorderStyle.SINGLE, size: 20, color: GOLD, space: 0 },
    },
    rows: [new TableRow({
      children: [new TableCell({
        borders: noBorders,
        shading: fillColor(NAVY),
        margins: { top: 480, bottom: 480, left: 600, right: 600 },
        children: [
          // Brand name
          new Paragraph({
            shading:  fillColor(NAVY),
            spacing:  { before: 0, after: 40 },
            children: [
              new TextRun({ text: 'Gravity', font: 'Arial', size: 72, bold: true, color: WHITE }),
              new TextRun({ text: 'ONE',     font: 'Arial', size: 72, bold: false, color: WHITE }),
            ],
          }),
          // Tagline
          new Paragraph({
            shading:  fillColor(NAVY),
            spacing:  { before: 0, after: 560 },
            children: [new TextRun({ text: 'Strategy Execution Platform', font: 'Arial', size: 26, color: GOLD })],
          }),
          // Doc type label
          new Paragraph({
            shading:  fillColor(NAVY),
            spacing:  { before: 0, after: 200 },
            children: [new TextRun({ text: (meta.docType ?? 'PROPOSAL').toUpperCase(), font: 'Arial', size: 21, bold: true, color: GOLD, characterSpacing: 60 })],
          }),
          // Document title (large)
          new Paragraph({
            shading:  fillColor(NAVY),
            spacing:  { before: 0, after: 640 },
            children: [new TextRun({ text: meta.title, font: 'Arial', size: 56, bold: true, color: WHITE })],
          }),
          // Metadata table
          metaTable,
        ],
      })],
    })],
  }));

  // ── Disclaimer below navy box
  parts.push(new Paragraph({
    spacing: { before: 360, after: 0 },
    children: [new TextRun({
      italics: true, font: 'Arial', size: 18, color: GREY,
      text: `This document constitutes GravityONE's formal response relative to the ${meta.title} prepared for ${meta.client ?? 'the client'}. All responses are binding and form part of our commercial offer.`,
    })],
  }));

  return parts;
}

// ─── Running header ───────────────────────────────────────────────────────────

function buildPageHeader(meta: DocMetadata): Header {
  return new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH_TWIPS }],
        border:   { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
        spacing:  { before: 0, after: 120 },
        children: [
          new TextRun({ text: 'GravityONE', font: 'Arial', size: 18, bold: true, color: NAVY }),
          new TextRun({ text: '  |  ',      font: 'Arial', size: 18, color: GREY }),
          new TextRun({ text: meta.title,   font: 'Arial', size: 18, color: NAVY }),
          new Tab(),
          new TextRun({ text: 'CONFIDENTIAL', font: 'Arial', size: 18, bold: true, color: GREY }),
        ],
      }),
    ],
  });
}

// ─── Running footer ───────────────────────────────────────────────────────────

function buildPageFooter(meta: DocMetadata): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border:    { top: { style: BorderStyle.SINGLE, size: 4, color: GREY_MID, space: 4 } },
        spacing:   { before: 80, after: 0 },
        children: [
          new TextRun({ text: 'GravityONE',               font: 'Arial', size: 17, bold: true, color: NAVY }),
          new TextRun({ text: '  |  ',                    font: 'Arial', size: 17, color: GREY }),
          new TextRun({ text: meta.docType ?? 'Proposal', font: 'Arial', size: 17, color: NAVY }),
          new TextRun({ text: '  |  Ref: ',               font: 'Arial', size: 17, color: GREY }),
          new TextRun({ text: meta.reference ?? '',       font: 'Arial', size: 17, color: NAVY }),
          new TextRun({ text: '  |  Page ',               font: 'Arial', size: 17, color: GREY }),
          new TextRun({ font: 'Arial', size: 17, color: NAVY, children: [PageNumber.CURRENT] }),
          new TextRun({ text: ' of ',                     font: 'Arial', size: 17, color: GREY }),
          new TextRun({ font: 'Arial', size: 17, color: NAVY, children: [PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });
}

// ─── Content table builder ────────────────────────────────────────────────────

function splitTableRow(row: string): string[] {
  return row.split('|').slice(1, -1).map(c => c.trim());
}

function isSeparatorRow(row: string): boolean {
  return /^\|[\s|:-]+\|$/.test(row.trim());
}

function buildContentTable(tableLines: string[]): Table {
  const headers  = splitTableRow(tableLines[0]);
  const dataRows = tableLines.slice(2).filter(r => r.trim() && r.includes('|'));
  const colPct   = Math.floor(100 / Math.max(headers.length, 1));

  return new Table({
    width:   { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:              { style: BorderStyle.SINGLE, size: 4, color: NAVY },
      bottom:           { style: BorderStyle.SINGLE, size: 4, color: NAVY },
      left:             { style: BorderStyle.SINGLE, size: 4, color: NAVY },
      right:            { style: BorderStyle.SINGLE, size: 4, color: NAVY },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: GREY_MID },
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: GREY_MID },
    },
    rows: [
      // Header row — navy fill (using CLEAR so fill color is applied)
      new TableRow({
        tableHeader: true,
        children: headers.map(h =>
          new TableCell({
            shading:  fillColor(NAVY),
            children: [new Paragraph({
              alignment: AlignmentType.LEFT,
              spacing:   { before: 120, after: 120 },
              children:  [new TextRun({ text: h, bold: true, color: WHITE, font: 'Arial', size: 20 })],
            })],
          }),
        ),
      }),
      // Body rows — alternating white / light grey fills
      ...dataRows.map((row, idx) =>
        new TableRow({
          children: splitTableRow(row).map(cell =>
            new TableCell({
              shading:  fillColor(idx % 2 === 0 ? WHITE : GREY_LIGHT),
              children: [new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing:   { before: 80, after: 80 },
                // Explicit dark color — avoids any style inheritance
                children:  parseInline(cell, 'Arial', 20, BODY_COLOR),
              })],
            }),
          ),
        }),
      ),
    ],
  });
}

// ─── Content children builder ─────────────────────────────────────────────────

export function buildDocxChildren(
  markdown: string,
  style:    DocStyleConfig = DEFAULT_STYLE,
): (Paragraph | Table)[] {
  const lines    = markdown.split('\n');
  const children: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const trim = lines[i].trim();

    // Blank line
    if (!trim) {
      children.push(new Paragraph({ children: [], spacing: { after: 100 } }));
      i++; continue;
    }

    // Markdown table
    if (trim.startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length > 2) {
        children.push(buildContentTable(tableLines));
        children.push(new Paragraph({ children: [], spacing: { after: 180 } }));
      }
      continue;
    }

    // Horizontal rule — render as a thin line, not as text
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trim)) {
      children.push(new Paragraph({
        children: [],
        border:   { bottom: { style: BorderStyle.SINGLE, size: 4, color: GREY_MID, space: 0 } },
        spacing:  { before: 160, after: 160 },
      }));
      i++; continue;
    }

    // H1 — navy + gold bottom border
    if (/^# /.test(trim)) {
      children.push(new Paragraph({
        children:  parseInline(trim.slice(2), style.h1Font, style.h1Size, NAVY, true),
        heading:   HeadingLevel.HEADING_1,
        alignment: AlignmentType.LEFT,
        border:    { bottom: { style: BorderStyle.SINGLE, size: 10, color: GOLD, space: 4 } },
        spacing:   { before: 480, after: 220 },
      }));
      i++; continue;
    }

    // H2 — navy bold
    if (/^## /.test(trim)) {
      children.push(new Paragraph({
        children:  parseInline(trim.slice(3), style.h2Font, style.h2Size, NAVY, true),
        heading:   HeadingLevel.HEADING_2,
        alignment: AlignmentType.LEFT,
        spacing:   { before: 320, after: 120 },
      }));
      i++; continue;
    }

    // H3
    if (/^### /.test(trim)) {
      children.push(new Paragraph({
        children:  parseInline(trim.slice(4), style.h3Font, style.h3Size, NAVY, true),
        heading:   HeadingLevel.HEADING_3,
        alignment: AlignmentType.LEFT,
        spacing:   { before: 240, after: 100 },
      }));
      i++; continue;
    }

    // Blockquote — gold left border, warm tint background
    if (/^> /.test(trim)) {
      children.push(new Paragraph({
        children:  parseInline(trim.slice(2), style.bodyFont, style.bodySize, NAVY),
        alignment: AlignmentType.LEFT,
        indent:    { left: 560 },
        shading:   fillColor('FFF8EC'),
        border:    { left: { style: BorderStyle.SINGLE, size: 14, color: GOLD, space: 10 } },
        spacing:   { before: 120, after: 120 },
      }));
      i++; continue;
    }

    // Bullet
    if (/^[-*+] /.test(trim)) {
      children.push(new Paragraph({
        children:  parseInline(trim.slice(2), style.bodyFont, style.bodySize, BODY_COLOR),
        bullet:    { level: 0 },
        alignment: AlignmentType.BOTH,
        spacing:   { before: 60, after: 60 },
      }));
      i++; continue;
    }

    // Ordered list
    const ordered = trim.match(/^(\d+)\. (.*)/);
    if (ordered) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${ordered[1]}.   `, bold: true, font: style.bodyFont, size: style.bodySize, color: BODY_COLOR }),
          ...parseInline(ordered[2], style.bodyFont, style.bodySize, BODY_COLOR),
        ],
        alignment: AlignmentType.BOTH,
        indent:    { left: 360, hanging: 360 },
        spacing:   { before: 60, after: 60 },
      }));
      i++; continue;
    }

    // Regular paragraph — justified
    children.push(new Paragraph({
      children:  parseInline(trim, style.bodyFont, style.bodySize, BODY_COLOR),
      alignment: AlignmentType.BOTH,
      spacing:   { before: 80, after: 80, line: 340 },
    }));
    i++;
  }

  return children;
}

// ─── Build Document ───────────────────────────────────────────────────────────

export function buildDocument(
  markdown:      string,
  title?:        string,
  style:         DocStyleConfig       = DEFAULT_STYLE,
  metaOverrides: Partial<DocMetadata> = {},
): Document {
  const meta   = deriveMetadata(markdown, { title, ...metaOverrides });
  const header = buildPageHeader(meta);
  const footer = buildPageFooter(meta);

  return new Document({
    creator:     'GravityONE Proposal AI Studio',
    title:       meta.title,
    description: `Generated by GravityONE Proposal AI Studio — ${meta.reference}`,

    styles: {
      default: {
        document: {
          run:       { font: style.bodyFont, size: style.bodySize, color: BODY_COLOR },
          paragraph: { spacing: { line: 340, lineRule: 'auto' as any } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal',
          run:       { font: style.h1Font, size: style.h1Size, bold: true, color: NAVY },
          paragraph: { spacing: { before: 480, after: 220 } },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal',
          run:       { font: style.h2Font, size: style.h2Size, bold: true, color: NAVY },
          paragraph: { spacing: { before: 320, after: 120 } },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal',
          run:       { font: style.h3Font, size: style.h3Size, bold: true, color: NAVY },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
      ],
    },

    sections: [
      // Section 1: Cover page — no running header/footer
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { margin: { top: MARGIN_TWIPS, right: MARGIN_TWIPS, bottom: MARGIN_TWIPS, left: MARGIN_TWIPS } },
        },
        children: buildCoverPage(meta) as Paragraph[],
      },

      // Section 2: Content pages — with running header & footer
      {
        properties: {
          page: {
            margin: {
              top:    MARGIN_TWIPS + 400,
              right:  MARGIN_TWIPS,
              bottom: MARGIN_TWIPS + 200,
              left:   MARGIN_TWIPS,
            },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: buildDocxChildren(markdown, style) as Paragraph[],
      },
    ],
  });
}

// ─── Client-side fallback export ─────────────────────────────────────────────

export async function exportMarkdownToDocx(
  markdown:  string,
  filename?: string,
  style?:    DocStyleConfig,
): Promise<void> {
  const name = filename ?? deriveFilename(markdown);
  const doc  = buildDocument(markdown, name.replace(/\.docx$/i, '').replace(/_/g, ' '), style ?? DEFAULT_STYLE);
  const blob = await Packer.toBlob(doc);
  saveAs(blob, name);
}
