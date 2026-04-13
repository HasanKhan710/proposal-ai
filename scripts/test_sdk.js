const { GoogleGenAI } = require('@google/genai');
const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });

async function verifyAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env.local');
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    console.log('✅ SDK initialized successfully.');

    // List models to see what is actually available
    const embedResponse = await ai.models.embedContent({
      model: 'text-embedding-004',
      content: { parts: [{ text: 'Hello world' }] },
    });

    if (embedResponse.embeddings[0]?.values) {
      console.log(`✅ Embedding successful! Vector size: ${embedResponse.embeddings[0].values.length}`);
    } else {
      console.error('❌ Embedding failed: Missing vector values.');
    }
  } catch (error) {
    console.error(error);
  }
}

verifyAI();
