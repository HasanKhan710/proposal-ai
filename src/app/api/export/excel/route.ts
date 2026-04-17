import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { ComplianceRow } from '@/lib/compliance';

// ─── Brand colours ────────────────────────────────────────────────────────────
const NAVY  = '1D3461';
const GOLD  = 'B8933F';
const WHITE = 'FFFFFF';

// Compliant status fills
const STATUS_FILL: Record<string, string> = {
  Yes:     'D1FAE5',  // green-100
  Partial: 'FEF3C7',  // amber-100
  No:      'FEE2E2',  // red-100
  '?':     'EDE9FE',  // purple-100
  NA:      'F3F4F6',  // grey-100
};
const STATUS_FONT: Record<string, string> = {
  Yes:     '065F46',
  Partial: '92400E',
  No:      '991B1B',
  '?':     '5B21B6',
  NA:      '374151',
};

function argb(hex: string) {
  return `FF${hex.toUpperCase()}`;
}

function solidFill(hex: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } };
}

function thinBorder(hex = 'D1D5DB'): Partial<ExcelJS.Borders> {
  const side: ExcelJS.Border = { style: 'thin', color: { argb: argb(hex) } };
  return { top: side, left: side, bottom: side, right: side };
}

export async function POST(req: NextRequest) {
  let body: { rows: ComplianceRow[]; filename?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { rows, filename = 'compliance-check' } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided.' }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GravityONE Proposal Studio';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Compliance Check', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // ── Column definitions ───────────────────────────────────────────────────────
  sheet.columns = [
    { header: 'Req #',          key: 'reqNum',      width: 8  },
    { header: 'Requirement',    key: 'requirement',  width: 52 },
    { header: 'Compliant?',     key: 'compliant',    width: 14 },
    { header: 'Confidence %',   key: 'confidence',   width: 14 },
    { header: 'Response / Comments (Opt 1)', key: 'response', width: 60 },
    { header: 'Option 2',       key: 'option2',      width: 60 },
    { header: 'Option 3',       key: 'option3',      width: 60 },
    { header: 'Source(s)',      key: 'sources',      width: 36 },
  ];

  // ── Header row styling ───────────────────────────────────────────────────────
  const headerRow = sheet.getRow(1);
  headerRow.height = 28;

  headerRow.eachCell(cell => {
    cell.fill = solidFill(NAVY);
    cell.font = { bold: true, color: { argb: argb(WHITE) }, size: 11, name: 'Calibri' };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder(GOLD);
  });

  // Auto filter on header row (now 8 columns)
  sheet.autoFilter = { from: 'A1', to: 'H1' };

  // ── Data rows ────────────────────────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const even      = idx % 2 === 1;
    const rowFill   = solidFill(even ? 'F9FAFB' : WHITE);
    const borderCol = 'E5E7EB';
    const conf      = row.confidence ?? 0;

    const dataRow = sheet.addRow({
      reqNum:      row.reqNum,
      requirement: row.requirement,
      compliant:   row.compliant,
      confidence:  `${conf}%`,
      response:    row.response,
      option2:     row.option2,
      option3:     row.option3,
      sources:     row.sources,
    });

    dataRow.height = 60;

    dataRow.eachCell((cell, colNumber) => {
      cell.font      = { size: 10, name: 'Calibri', color: { argb: argb('111827') } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border    = thinBorder(borderCol);

      // Req# — centred
      if (colNumber === 1) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.font = { ...cell.font, bold: true };
        cell.fill = rowFill;
        return;
      }

      // Compliant? — colour-coded (col 3)
      if (colNumber === 3) {
        const status = String(row.compliant);
        const bg = STATUS_FILL[status] ?? 'F3F4F6';
        const fg = STATUS_FONT[status] ?? '374151';
        cell.fill      = solidFill(bg);
        cell.font      = { size: 10, name: 'Calibri', bold: true, color: { argb: argb(fg) } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
        return;
      }

      // Confidence % — colour-coded (col 4)
      if (colNumber === 4) {
        const bg = conf >= 80 ? 'D1FAE5' : conf >= 55 ? 'FEF3C7' : 'FEE2E2';
        const fg = conf >= 80 ? '065F46' : conf >= 55 ? '92400E' : '991B1B';
        cell.fill      = solidFill(bg);
        cell.font      = { size: 10, name: 'Calibri', bold: true, color: { argb: argb(fg) } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
        return;
      }

      cell.fill = rowFill;
    });
  });

  // ── Summary row at bottom ────────────────────────────────────────────────────
  const total      = rows.length;
  const yes        = rows.filter(r => r.compliant === 'Yes').length;
  const partial    = rows.filter(r => r.compliant === 'Partial').length;
  const no         = rows.filter(r => r.compliant === 'No').length;
  const unknown    = rows.filter(r => r.compliant === '?').length;
  const needReview = rows.filter(r => (r.confidence ?? 0) < 55).length;

  const summaryRow = sheet.addRow({
    reqNum:      '',
    requirement: `SUMMARY: ${total} requirements — Yes: ${yes} | Partial: ${partial} | No: ${no} | Unknown: ${unknown} | Needs review: ${needReview}`,
    compliant:   '',
    confidence:  '',
    response:    '',
    option2:     '',
    option3:     '',
    sources:     '',
  });
  summaryRow.height = 22;

  const summaryCell = summaryRow.getCell(2);
  summaryCell.fill  = solidFill('F0F4FF');
  summaryCell.font  = { bold: true, size: 10, name: 'Calibri', color: { argb: argb('1D3461') } };
  summaryCell.alignment = { vertical: 'middle', wrapText: false };

  // ── Serialise ────────────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();

  const safe = filename.replace(/[^\w\s\-]/g, '').trim().replace(/\s+/g, '-') || 'compliance-check';
  const disposition = `attachment; filename="${safe}.xlsx"`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': disposition,
    },
  });
}
