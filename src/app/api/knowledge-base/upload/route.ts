import { NextResponse } from 'next/server';
import { createChunk, createDocument, updateDocumentChunkCount } from '@/lib/db';
import { extractText } from '@/lib/parsers';
import { generateEmbedding, chunkText } from '@/lib/ai';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';
import { saveProposalUpload } from '@/lib/storage';

export const maxDuration = 60; // Allow 60 seconds for larger files

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
    const fileType = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';

    await createDocument({
      id: documentId,
      name: file.name,
      filePath,
      fileType,
      uploadedBy: session.email,
    });

    // Chunk and embed the text
    const chunks = chunkText(text);
    let chunkCount = 0;

    // Process chunks sequentially - embed each one and store
    for (let index = 0; index < chunks.length; index++) {
        const chunkContent = chunks[index];
        const chunkId = uuidv4();
        
        try {
            const embedding = await generateEmbedding(chunkContent);
            await createChunk({
              id: chunkId,
              documentId,
              content: chunkContent,
              chunkIndex: index,
              embedding: JSON.stringify(embedding),
            });
            chunkCount++;
        } catch (e) {
            // Still save the chunk text even if embedding fails
            await createChunk({
              id: chunkId,
              documentId,
              content: chunkContent,
              chunkIndex: index,
              embedding: null,
            });
            console.error(`Failed to embed chunk ${index} in document ${file.name}:`, e);
        }
    }

    // Update chunk count
    await updateDocumentChunkCount(documentId, chunkCount);

    return NextResponse.json({ 
      success: true, 
      documentId,
      message: `Successfully processed ${file.name} into ${chunkCount} chunks.`
    });

  } catch (error: any) {
    console.error('File upload/processing error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
