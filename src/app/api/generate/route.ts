import { searchSimilarChunks, generateProposal, saveGeneratedProposal } from '@/lib/ai';
import { getSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return new Response('Unauthorized', { status: 401 });

    const { prompt, mode, currentProposal } = await request.json();

    if (!prompt || !mode) {
      return new Response('Prompt and mode are required', { status: 400 });
    }

    const isRevision = !!currentProposal;
    let contextText = '';

    if (isRevision) {
      // Revision: use the current proposal as context — no RAG needed
      contextText = currentProposal;
    } else {
      // Fresh generation: retrieve relevant knowledge base chunks
      const relevantChunks = await searchSimilarChunks(prompt, 6);
      contextText = relevantChunks.length > 0
        ? relevantChunks.map(c => `[Source: ${c.name}]\n${c.content}`).join('\n\n---\n\n')
        : 'No relevant context found in past proposals.';
    }

    // Stream from Gemini
    const responseStream = await generateProposal(
      prompt,
      contextText,
      isRevision ? 'revise' : mode,
    );

    let fullOutput = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const text = chunk.text;
            fullOutput += text;
            controller.enqueue(new TextEncoder().encode(text));
          }

          // Save to history — title from first 6 words of prompt
          const title = prompt.split(' ').slice(0, 6).join(' ') + '…';
          await saveGeneratedProposal({
            userId: session.id,
            mode: isRevision ? 'improve' : mode,
            prompt,
            output: fullOutput,
            title,
          });

          controller.close();
        } catch (err) {
          console.error('[Generate] Streaming error:', err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (error: any) {
    console.error('[Generate] Error:', error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}
