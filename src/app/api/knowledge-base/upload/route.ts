import { NextResponse } from 'next/server';
import { createChunk, createDocument, updateDocumentChunkCount } from '@/lib/db';
import { extractText, detectFileType, extractXlsxKbRows } from '@/lib/parsers';
import { generateEmbedding, chunkText } from '@/lib/ai';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { saveProposalUpload } from '@/lib/storage';

export const maxDuration = 120; // Allow 120 seconds — sequential embedding with 1 s delays

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // Parse the document text
    const text = await extractText(buffer, file.type, file.name);
    console.log(`[Upload API] Extracted text from ${file.name}. Total length: ${text?.length || 0} chars`);
    
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: 'Could not extract text from document' }, { status: 400 });
    }

    const savedFileName = `${uuidv4()}-${file.name.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
    const filePath = await saveProposalUpload(savedFileName, buffer, file.type);

    // Create DB entry for the document
    const documentId = uuidv4();
    const fileType = detectFileType(file.type, file.name) ?? 'docx';

    await createDocument({
      id: documentId,
      name: file.name,
      filePath,
      fileType,
      uploadedBy: session.email,
    });

    let chunkCount  = 0;
    let retryCount  = 0;

    // Helper: 1-second delay before each embedding call; 10-second retry on 429.
    async function embedWithDelay(text: string, label: string): Promise<string | null> {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const emb = await generateEmbedding(text);
        return JSON.stringify(emb);
      } catch (err: any) {
        const status = err.status ?? err.response?.status;
        if (status === 429) {
          retryCount++;
          console.warn(`[Upload API] 429 on ${label} — waiting 10 s before retry…`);
          await new Promise(r => setTimeout(r, 10_000));
          try {
            const emb = await generateEmbedding(text);
            return JSON.stringify(emb);
          } catch (err2) {
            console.error(`[Upload API] Retry also failed for ${label}:`, err2);
            return null;
          }
        }
        console.error(`[Upload API] Embedding error for ${label}:`, err);
        return null;
      }
    }

    if (fileType === 'xlsx') {
      const kbRows = await extractXlsxKbRows(buffer);

      if (kbRows.length > 0) {
        console.log(`[Upload API] Excel structured mode: ${kbRows.length} KB rows extracted.`);
        for (let index = 0; index < kbRows.length; index++) {
          const { searchText, content } = kbRows[index];
          const chunkId   = uuidv4();
          const embedding = await embedWithDelay(searchText, `${file.name} row ${index}`);
          await createChunk({ id: chunkId, documentId, content, chunkIndex: index, embedding });
          if (embedding) chunkCount++;
        }
      } else {
        console.log(`[Upload API] Excel: no response column found, falling back to full-text chunking.`);
        const chunks = chunkText(text);
        for (let index = 0; index < chunks.length; index++) {
          const chunkId   = uuidv4();
          const embedding = await embedWithDelay(chunks[index], `${file.name} chunk ${index}`);
          await createChunk({ id: chunkId, documentId, content: chunks[index], chunkIndex: index, embedding });
          if (embedding) chunkCount++;
        }
      }
    } else {
      const chunks = chunkText(text);
      for (let index = 0; index < chunks.length; index++) {
        const chunkId   = uuidv4();
        const embedding = await embedWithDelay(chunks[index], `${file.name} chunk ${index}`);
        await createChunk({ id: chunkId, documentId, content: chunks[index], chunkIndex: index, embedding });
        if (embedding) chunkCount++;
      }
    }

    // Update chunk count
    await updateDocumentChunkCount(documentId, chunkCount);

    const retryNote = retryCount > 0 ? ` (${retryCount} rate-limit retr${retryCount === 1 ? 'y' : 'ies'})` : '';
    return NextResponse.json({
      success: true,
      documentId,
      chunks:  chunkCount,
      retries: retryCount,
      message: `Successfully processed ${file.name} into ${chunkCount} chunks.${retryNote}`,
    });

  } catch (error: any) {
    console.error('File upload/processing error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
