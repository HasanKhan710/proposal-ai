import { NextRequest, NextResponse } from 'next/server';
import {
  extractRequirementsFromExcel,
  buildComplianceRows,
} from '@/lib/compliance';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? '';

  let requirements: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    // Excel file upload
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Failed to parse form data.' }, { status: 400 });
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      return NextResponse.json({ error: 'Only Excel files (.xlsx, .xls) are supported.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      requirements = extractRequirementsFromExcel(buffer);
    } catch {
      return NextResponse.json({ error: 'Failed to parse Excel file.' }, { status: 400 });
    }

    if (requirements.length === 0) {
      return NextResponse.json(
        { error: 'No requirements found. Ensure the file has a column with a header containing: requirement, feature, description, or function.' },
        { status: 422 },
      );
    }
  } else {
    // JSON body: { requirements: string[] } or { text: string }
    let body: { requirements?: string[]; text?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (Array.isArray(body.requirements) && body.requirements.length > 0) {
      requirements = body.requirements.map(String).filter(r => r.trim().length > 0);
    } else if (typeof body.text === 'string' && body.text.trim()) {
      // Split plain text on newlines / numbered lists
      requirements = body.text
        .split(/\n+/)
        .map(line => line.replace(/^\s*\d+[\.\)]\s*/, '').trim())
        .filter(line => line.length >= 8);
    }

    if (requirements.length === 0) {
      return NextResponse.json({ error: 'No requirements provided.' }, { status: 400 });
    }
  }

  try {
    const rows = await buildComplianceRows(requirements);
    return NextResponse.json({ rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Compliance check failed: ${msg}` }, { status: 500 });
  }
}
