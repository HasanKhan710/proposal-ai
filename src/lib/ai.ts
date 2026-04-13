import { GoogleGenAI } from '@google/genai';
import { createProposal, listChunkSearchRecords } from './db';

// CORRECT initialization for the new 2025 SDK (@google/genai)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
});

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    // New SDK pattern: ai.models.embedContent
    const response = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: [{ parts: [{ text }] }],
    });
    
    if (!response.embeddings?.[0]?.values) {
      throw new Error('Failed to generate embedding: empty values');
    }
    
    return response.embeddings[0].values;
  } catch (error: any) {
    console.error(`[AI] Embedding error: ${error.message}`);
    throw error;
  }
}

export function chunkText(text: string, maxTokens: number = 500, overlap: number = 100): string[] {
  console.log(`[Chunker] Starting chunking. Input text length: ${text.length} chars`);
  const chunkSize = maxTokens * 4;
  const overlapSize = overlap * 4;
  
  const chunks: string[] = [];
  let i = 0;
  
  while (i < text.length) {
    let end = i + chunkSize;
    
    if (end < text.length) {
      const nextNewline = text.indexOf('\n\n', end - 200);
      const nextPeriod = text.indexOf('. ', end - 100);
      
      if (nextNewline !== -1 && nextNewline < end + 200) {
        end = nextNewline + 2;
      } else if (nextPeriod !== -1 && nextPeriod < end + 100) {
        end = nextPeriod + 2;
      }
    } else {
      end = text.length;
    }
    
    const chunk = text.slice(i, end).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }
    
    i = end - overlapSize;
    if (i < 0) i = 0;
    if (end <= i && end < text.length) i = end;
    if (end === text.length) break;
  }
  
  console.log(`[Chunker] Finished chunking. Produced ${chunks.length} chunks.`);
  return chunks;
}

// Pure JS cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function searchSimilarChunks(query: string, limit: number = 5): Promise<any[]> {
  const queryEmbedding = await generateEmbedding(query);

  const allChunks = await listChunkSearchRecords();

  if (allChunks.length === 0) {
    return [];
  }

  // Compute cosine similarity for each chunk
  const scored = allChunks.map(chunk => {
    try {
      if (!chunk.embedding) {
        return { ...chunk, similarity: 0 };
      }

      const chunkEmbedding = JSON.parse(chunk.embedding) as number[];
      const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
      return { ...chunk, similarity };
    } catch (e) {
      return { ...chunk, similarity: 0 };
    }
  });

  // Sort by similarity descending and take top-K
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

export async function saveGeneratedProposal(input: {
  userId: string;
  mode: string;
  prompt: string;
  output: string;
  title: string;
}) {
  return createProposal(input);
}

export async function generateProposal(prompt: string, context: string, mode: string): Promise<any> {
  const modeLabels: Record<string, string> = {
    new: 'Generate a complete, professional business proposal.',
    feedback: 'Generate a professional response to the client feedback below.',
    improve: 'Enhance, polish, and strengthen the draft proposal below using insights from past successful proposals.',
  };

  const isRevision = mode === 'revise';

  const systemInstruction = isRevision
    ? `You are an expert business proposal writer working for Gravity One's internal Proposal AI Studio.
You are refining an existing proposal based on a specific revision request.
Guidelines:
- Return the COMPLETE revised proposal in full — never just the changed sections.
- Apply only the requested changes; preserve all other content and formatting.
- Maintain the professional tone and Markdown structure of the original.
- Use clear section headings throughout.`
    : `You are an expert business proposal writer for Gravity One's internal BD team.
You have access to excerpts from the organisation's past successful proposals. Use them to inform tone, structure, and quality.
Your task: ${modeLabels[mode] || modeLabels.new}
Guidelines:
- Write in a confident, professional, and persuasive tone.
- Use clear section headings (Executive Summary, Scope, Methodology, Timeline, Investment, etc.) for full proposals.
- Reference specific capabilities from the context where relevant.
- Do NOT copy verbatim — adapt and tailor to the current request.
- Format the output using Markdown.`;

  const fullPrompt = isRevision
    ? `## Current Proposal\n\n${context}\n\n---\n\n## Revision Request\n\n${prompt}\n\nReturn the full revised proposal.`
    : `## Context from Past Proposals\n${context}\n\n---\n\n## User Request\n${prompt}`;

  // Robust fallback pattern for high API demand across Google's infrastructure
  const modelsToTry = [
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemma-3-12b-it',
    'gemma-3-4b-it'
  ];

  let responseStream;
  let lastError;

  for (const modelName of modelsToTry) {
    try {
      console.log(`[AI] Attempting generation with model: ${modelName}`);
      responseStream = await ai.models.generateContentStream({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        config: {
          systemInstruction: systemInstruction,
        },
      });
      console.log(`[AI] Successfully attached to ${modelName}`);
      break; // Success! Break out of the fallback loop.
    } catch (error: any) {
      lastError = error;
      const status = error.status || (error.response && error.response.status);
      if (status === 503 || status === 429) {
        console.warn(`[AI] Model ${modelName} heavily loaded (Status ${status}). Trying fallback...`);
        continue;
      }
      // If it's a different error (e.g. 400 Bad Request, 404 Not Found), fail immediately
      throw error;
    }
  }

  if (!responseStream) {
    console.error(`[AI] All generation models failed. Last error:`, lastError);
    throw new Error('Google Generative AI is currently experiencing massive global service unavailability across all model tiers. Please try again in 5 minutes.');
  }

  return responseStream;
}
