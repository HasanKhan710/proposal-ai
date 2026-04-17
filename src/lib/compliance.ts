import * as XLSX from 'xlsx';
import { generateEmbedding, callGemini } from './ai';
import { listChunkSearchRecordsWithDoc } from './db';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComplianceStatus = 'Yes' | 'Partial' | 'No' | 'NA' | '?';

export interface ComplianceRow {
  reqNum:      number;
  requirement: string;
  compliant:   ComplianceStatus;
  /** 0–100: Gemini's self-reported certainty about the compliance verdict. */
  confidence:  number;
  response:    string;
  option2:     string;
  option3:     string;
  sources:     string;
}

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Score-based fallback (used only when Gemini is unavailable) ──────────────

function inferCompliance(score: number): ComplianceStatus {
  if (score >= 0.72) return 'Yes';
  if (score >= 0.52) return 'Partial';
  if (score >= 0.35) return 'No';
  return '?';
}

// ─── Excel requirement extraction ─────────────────────────────────────────────

const REQ_KEYWORDS = ['requirement', 'feature', 'description', 'function', 'req id', 'item'];

export function extractRequirementsFromExcel(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const requirements: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet   = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1, defval: '', blankrows: false,
    });

    if (rows.length < 2) continue;

    let headerRowIdx = -1;
    let reqColIdx    = -1;

    for (let ri = 0; ri < Math.min(15, rows.length); ri++) {
      const row = rows[ri];
      for (let ci = 0; ci < row.length; ci++) {
        const cell = String(row[ci]).toLowerCase().trim();
        if (REQ_KEYWORDS.some(kw => cell.includes(kw))) {
          headerRowIdx = ri;
          reqColIdx    = ci;
          break;
        }
      }
      if (headerRowIdx !== -1) break;
    }

    if (reqColIdx === -1) {
      outer: for (let ri = 0; ri < Math.min(5, rows.length); ri++) {
        for (let ci = 0; ci < rows[ri].length; ci++) {
          if (String(rows[ri][ci]).trim().length > 20) {
            headerRowIdx = ri;
            reqColIdx    = ci;
            break outer;
          }
        }
      }
    }

    if (reqColIdx === -1) continue;

    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const cell = String(rows[ri][reqColIdx] ?? '').trim();
      if (cell.length < 8) continue;
      if (/^[A-Z0-9\s\-]{2,30}$/.test(cell) && cell.split(' ').length <= 3) continue;
      requirements.push(cell);
    }
  }

  return requirements;
}

// ─── KB search ────────────────────────────────────────────────────────────────

interface MatchedOption {
  content:         string;  // full stored content (may include [Req:] and [Compliance:] tags)
  requirementText: string;  // extracted from [Req: ...] prefix, or '' if not present
  source:          string;  // "DocName.xlsx (chunk N)"
  docName:         string;  // "DocName.xlsx"
  score:           number;
}

const AI_QUERY_TRIGGER_RE =
  /\b(artificial intelligence|ai|machine learning|predictive analytics)\b/i;

function expandRequirementForRetrieval(requirement: string): string {
  if (!AI_QUERY_TRIGGER_RE.test(requirement)) return requirement;

  const expanded = `${requirement} AI Support Capability AI framework`;
  console.log(`[Compliance] AI retrieval expansion applied: "${expanded}"`);
  return expanded;
}

/** Extracts the [Req: ...] prefix from stored chunk content, returns '' if absent. */
function parseReqText(content: string): string {
  const m = content.match(/^\[Req: (.*?)\]\n?/);
  return m ? m[1] : '';
}

/**
 * Strips common requirement preamble phrases to produce a shorter, more
 * keyword-focused query — e.g. "The system must utilise AI for analysis"
 * becomes "utilise AI for analysis".  Returns null if the result is not
 * meaningfully shorter than the original.
 */
function deriveShortQuery(requirement: string): string | null {
  const stripped = requirement
    .replace(
      /^(the system (must|shall|should|will|needs? to)|the (tool|platform|application|software|solution) (must|shall|should|will)|it must|ensure( that)?|provide( a)?|support|allow(ing)?|be able to)\s+/i,
      '',
    )
    .trim();

  if (stripped.length <= requirement.length - 15) {
    return stripped.split(/\s+/).slice(0, 8).join(' ');
  }
  return null;
}

/**
 * Reads the [Compliance: ...] tag from the top chunk's content and normalises
 * it to Yes / Partial / No.  Used for code-level primacy enforcement.
 */
function extractComplianceTag(content: string): 'Yes' | 'Partial' | 'No' | null {
  const m = content.match(/\[Compliance:\s*(.*?)\]/i);
  if (!m) return null;
  const v = m[1].toLowerCase().trim();
  if (/^(yes|fully compliant|compliant|full compliance|fully met|meets)$/.test(v)) return 'Yes';
  if (/^(partial|partially compliant|partial compliance|partially met)$/.test(v)) return 'Partial';
  if (/^(no|n|non-?compliant|not compliant|does not meet|not met)$/.test(v)) return 'No';
  return null;
}

function complianceWeight(tag: 'Yes' | 'Partial' | 'No'): number {
  if (tag === 'Yes') return 1;
  if (tag === 'Partial') return 0.5;
  return 0; // No
}

/**
 * Derives a weighted compliance verdict from top-5 chunks.
 * Only chunks with an explicit [Compliance:] tag participate in the vote —
 * untagged chunks are excluded entirely so they cannot dilute a Yes score.
 * Returns null when no tagged chunks exist (caller should fall back to Gemini verdict).
 */
function weightedComplianceFromTopChunks(options: MatchedOption[]): {
  score: number;
  verdict: Exclude<ComplianceStatus, 'NA' | '?'>;
} | null {
  // Fix 1: only explicitly-tagged chunks participate in the weighted vote
  const taggedChunks = options
    .slice(0, 5)
    .filter(o => extractComplianceTag(o.content) !== null);

  if (taggedChunks.length === 0) return null; // signal: fall back to Gemini verdict

  let weightedSum = 0;
  let similaritySum = 0;

  for (const chunk of taggedChunks) {
    const tag = extractComplianceTag(chunk.content)!; // non-null guaranteed by filter
    weightedSum += chunk.score * complianceWeight(tag);
    similaritySum += chunk.score;
  }

  // Normalize by the total similarity so the requested thresholds operate on a
  // stable 0–1 scale across different queries.
  const normalizedScore = similaritySum > 0 ? weightedSum / similaritySum : 0;

  if (normalizedScore > 0.75) return { score: normalizedScore, verdict: 'Yes' };
  if (normalizedScore >= 0.4) return { score: normalizedScore, verdict: 'Partial' };
  return { score: normalizedScore, verdict: 'No' };
}

/**
 * Code-level enforcement of Fix 3:
 * If the highest-scoring chunk says Yes, override Gemini's Partial verdict.
 * Gemini is only allowed to downgrade if the top chunk itself says Partial.
 */
function enforceTopChunkPrimacy(
  geminiCompliance: ComplianceStatus,
  docOptions: DocOption[],
): ComplianceStatus {
  if (docOptions.length === 0 || geminiCompliance === 'Yes') return geminiCompliance;

  const topTag = extractComplianceTag(docOptions[0].chunk.content);
  if (topTag === 'Yes' && (geminiCompliance === 'Partial' || geminiCompliance === '?')) {
    const rawTag = docOptions[0].chunk.content.match(/\[Compliance:\s*(.*?)\]/i)?.[1] ?? 'Yes';
    console.log(`[Compliance] Override: Gemini="${geminiCompliance}" but top chunk [Compliance: ${rawTag}] → "Yes"`);
    return 'Yes';
  }
  return geminiCompliance;
}

// ─── Doc-level option selection (Fix 2 + 4) ───────────────────────────────────
// One chunk per document, top 3 documents by best-chunk score.
// Sources come from chunk metadata — never from Gemini.

interface DocOption {
  docName: string;
  chunk:   MatchedOption;
}

function selectTopDocOptions(options: MatchedOption[], minScore = 0.20): DocOption[] {
  const bestByDoc = new Map<string, MatchedOption>();
  for (const opt of options) {          // already sorted by score desc
    if (!bestByDoc.has(opt.docName)) bestByDoc.set(opt.docName, opt);
  }
  return Array.from(bestByDoc.values())
    .filter(o => o.score >= minScore)
    .slice(0, 3)
    .map(o => ({ docName: o.docName, chunk: o }));
}

/**
 * Retrieval: score ALL chunks, take globally best 15 (max 3 per document).
 *
 * Secondary boost: if the primary query's top score is below 0.40 (weak signal),
 * a shorter keyword-focused query is also embedded and scores are merged by max.
 * This improves recall when the client requirement is verbose but the KB uses
 * concise labels like "AI Support Capability".
 */
export async function searchForRequirement(requirement: string): Promise<MatchedOption[]> {
  const retrievalQuery = expandRequirementForRetrieval(requirement);
  const queryEmbedding = await generateEmbedding(retrievalQuery);
  const allChunks      = await listChunkSearchRecordsWithDoc();

  if (allChunks.length === 0) return [];

  // Parse embeddings once so we can score twice without re-parsing
  const parsed = allChunks
    .filter(c => c.embedding)
    .map(c => {
      try   { return { ...c, emb: JSON.parse(c.embedding!) as number[] }; }
      catch { return null; }
    })
    .filter(Boolean) as (typeof allChunks[0] & { emb: number[] })[];

  // Primary scoring
  let scored = parsed
    .map(c => ({ ...c, sim: cosineSimilarity(queryEmbedding, c.emb) }))
    .sort((a, b) => b.sim - a.sim);

  // Secondary boost when primary signal is weak
  const BOOST_THRESHOLD = 0.40;
  if ((scored[0]?.sim ?? 0) < BOOST_THRESHOLD) {
    const shortQ = deriveShortQuery(requirement);
    if (shortQ) {
      console.log(`[Compliance] Weak primary (${((scored[0]?.sim ?? 0) * 100).toFixed(0)}%) — secondary query: "${shortQ}"`);
      const shortEmb = await generateEmbedding(shortQ);
      scored = scored
        .map(c => ({ ...c, sim: Math.max(c.sim, cosineSimilarity(shortEmb, c.emb)) }))
        .sort((a, b) => b.sim - a.sim);
      console.log(`[Compliance] After boost — top score: ${(scored[0]?.sim * 100).toFixed(0)}% (${scored[0]?.name})`);
    }
  }

  const GLOBAL_LIMIT   = 15;
  const CHUNKS_PER_DOC = 3;
  const docChunkCounts = new Map<string, number>();
  const options: MatchedOption[] = [];

  for (const chunk of scored) {
    if (options.length >= GLOBAL_LIMIT) break;
    const count = docChunkCounts.get(chunk.document_id) ?? 0;
    if (count >= CHUNKS_PER_DOC) continue;
    docChunkCounts.set(chunk.document_id, count + 1);

    const content = chunk.content.trim();
    options.push({
      content,
      requirementText: parseReqText(content),
      source:          `${chunk.name} (chunk ${chunk.chunk_index + 1})`,
      docName:         chunk.name,
      score:           chunk.sim,
    });
  }

  return options; // sorted by score desc
}

// ─── Client-name sanitisation (Fix 3) ────────────────────────────────────────

/**
 * Single-word terms that are always acceptable in any response — technology
 * names, standards, geography, and provider names.
 */
const CLIENT_SAFE_WORDS = new Set([
  // Provider names
  'StrategyDotZero', 'SDZ', 'GravityiLabs', 'GIL',
  // Cloud / vendor platforms
  'Microsoft', 'Azure', 'AWS', 'Oracle', 'Google', 'GitHub',
  // Tools & formats
  'JIRA', 'Excel', 'PowerPoint', 'Word', 'PDF', 'Teams', 'SharePoint',
  // Standards & frameworks
  'ISO', 'IRAP', 'WCAG', 'RBAC', 'SSO', 'MFA', 'API', 'NLP', 'AI',
  'UI', 'UX', 'CRM', 'ERP', 'KPI', 'SLA', 'RFP', 'GDPR', 'ASD',
  // Geography (sentence-start use is common)
  'Australia', 'Australian',
  // Generic descriptor words that are always capitalised
  'English', 'French',
]);

/** Common sentence-starting or structural words that happen to be capitalised. */
const SENTENCE_STARTERS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'A', 'An', 'In', 'For', 'By',
  'To', 'With', 'Through', 'At', 'On', 'As', 'All', 'Both', 'Each',
  'Its', 'Their', 'It', 'If', 'When', 'Where', 'Additionally', 'Furthermore',
  'Moreover', 'However', 'Therefore', 'Specifically', 'StrategyDotZero',
]);

/**
 * Returns true when the text contains a capitalised proper noun (or possessive)
 * that is not in the safe list — a signal that a client name has leaked into the
 * generated option.
 *
 * Checks two patterns:
 *   1. Possessives — "Allianz's", "Health Department's"
 *   2. Standalone mid-sentence capitals — "Allianz provides" (word after a
 *      lowercase-ending word or mid-sentence position, so sentence-start
 *      capitals don't false-positive).
 */
function containsClientReference(text: string): boolean {
  // Pattern 1 — possessive proper nouns (single or multi-word)
  const possessiveRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)'s\b/g;
  for (const m of text.matchAll(possessiveRe)) {
    const noun = m[1].trim();
    const firstWord = noun.split(/\s+/)[0];
    if (!CLIENT_SAFE_WORDS.has(noun) && !CLIENT_SAFE_WORDS.has(firstWord)) {
      console.log(`[Compliance] Client reference (possessive) detected: "${noun}'s"`);
      return true;
    }
  }

  // Pattern 2 — bare capitalised word appearing after a lowercase word (mid-sentence),
  // which rules out the first word of a sentence while still catching org names.
  const midSentenceRe = /[a-z,;]\s+([A-Z][a-z]{2,})\b/g;
  for (const m of text.matchAll(midSentenceRe)) {
    const word = m[1];
    if (!CLIENT_SAFE_WORDS.has(word) && !SENTENCE_STARTERS.has(word)) {
      console.log(`[Compliance] Client reference (plain noun) detected: "${word}"`);
      return true;
    }
  }

  return false;
}

/**
 * Asks Gemini to rewrite a single option without client-specific references.
 * Called at most once per option (no further retries beyond the one attempt).
 */
async function sanitiseOption(
  text: string,
  requirement: string,
  label: string,
): Promise<string> {
  if (!text) return text;
  const sanitisePrompt = `The following capability statement was written for a proposal response but contains
client-specific names or references that must be removed.

ORIGINAL TEXT:
${text}

CONTEXT — the client requirement being addressed:
${requirement}

REWRITE RULES:
- Replace every client name, department name, or external organisation name with the
  generic provider name "StrategyDotZero" or "the platform" where appropriate.
- Keep all technical claims and capabilities intact.
- Write in fluent third-person professional prose.
- Do NOT add new claims that weren't present in the original.
- Return ONLY the rewritten text — no preamble, no labels, no JSON.`;

  try {
    const rewritten = (await callGemini(sanitisePrompt)).trim();
    console.log(`[Compliance] Sanitised ${label}: client reference removed.`);
    return rewritten;
  } catch (err) {
    console.error(`[Compliance] Sanitise rewrite failed for ${label}:`, err);
    return text; // return original if rewrite fails — don't lose the content
  }
}

// ─── Gemini synthesis ─────────────────────────────────────────────────────────

const VALID_STATUSES: ComplianceStatus[] = ['Yes', 'Partial', 'No', 'NA', '?'];

// Sources are now tracked externally via DocOption — Gemini never names them.
interface SynthesisResult {
  compliance: ComplianceStatus;
  confidence: number;
  response:   string;
  option2:    string;
  option3:    string;
}

/**
 * Synthesise compliance verdict + 3 option responses from pre-selected doc options.
 *
 * Each DocOption is one document's best chunk, already sorted by score desc.
 * OPTION 1 = highest-scoring document → primary compliance signal (Fix 3).
 * Sources are NOT requested from Gemini — they come from docOptions metadata (Fix 2).
 */
async function synthesiseWithGemini(
  requirement: string,
  docOptions:  DocOption[],
): Promise<SynthesisResult> {

  const SOURCE_LABELS = ['A', 'B', 'C'];
  const evidenceBlocks = docOptions.map((docOpt, i) => {
    const { chunk } = docOpt;
    const label = SOURCE_LABELS[i] ?? String(i + 1);
    const lines: string[] = [
      `SOURCE ${label} (Relevance: ${(chunk.score * 100).toFixed(0)}%):`,
    ];
    if (chunk.requirementText) lines.push(`Original KB Requirement: ${chunk.requirementText}`);
    lines.push(chunk.content);   // includes [Compliance: ...] tag + response text
    return lines.join('\n');
  });

  const prompt = `You are a compliance analyst assessing whether StrategyDotZero (SDZ) can meet a client requirement.

CLIENT REQUIREMENT:
${requirement}

EVIDENCE FROM KNOWLEDGE BASE (${docOptions.length} source${docOptions.length !== 1 ? 's' : ''}, ordered by relevance):
${evidenceBlocks.join('\n\n---\n\n')}

━━━ COMPLIANCE DETERMINATION RULES ━━━

1. IGNORE document-type bias. SLA agreements describe negotiated terms for specific clients —
   they do NOT prove SDZ lacks a broader capability. RFP responses, proposal documents, and
   appendix response sheets are the authoritative record of SDZ's stated capabilities.

2. HONOUR THE [Compliance:] TAG. Each option may include a tag from the original assessor.
   Treat it as an authoritative verdict. Equivalences:
   • [Compliance: Yes] = [Compliance: Fully compliant] = [Compliance: Compliant]
   • [Compliance: Partial] = [Compliance: Partially compliant]
   • [Compliance: No] = [Compliance: Non-compliant] = [Compliance: Not compliant]

3. COMPLIANCE DECISION LOGIC — apply in order:
   a. If SOURCE A (highest relevance) carries a Yes-equivalent tag AND its text confirms
      the capability without significant qualifiers → "Yes".
   b. If SOURCE A carries a Partial-equivalent tag → "Partial".
   c. If all sources explicitly state inability or non-availability → "No".
   d. If no source meaningfully addresses the requirement → "?".

4. WEIGHT COMPLIANCE BY RELEVANCE — SOURCE A IS PRIMARY:
   Evidence is ordered by relevance score. SOURCE A is the strongest signal.
   • If SOURCE A says Yes → verdict is "Yes", even if SOURCE B or C says Partial.
   • Downgrade to "Partial" ONLY if SOURCE A itself says Partial, OR if two or more
     sources say Partial AND they are topically relevant to the requirement.
   • A lower-relevance Partial from SOURCE B or C must NOT override a high-relevance
     Yes from SOURCE A.
   • Sources that do not address the requirement must be ignored entirely.

5. USE THE "Original KB Requirement" FIELD to verify a chunk is answering the right
   kind of question. If the KB requirement is on a very different topic than the client
   requirement, treat that option's compliance tag with caution.

━━━ RESPONSE WRITING ━━━

6. Write "response" using SOURCE A's evidence.
7. Write "option2" using SOURCE B's evidence. If SOURCE B is absent, use "".
8. Write "option3" using SOURCE C's evidence. If SOURCE C is absent, use "".
9. Each option must be a standalone professional capability statement about StrategyDotZero.
   Do NOT reference other sources in the text. Do NOT repeat chunk labels. Do NOT include
   client names, department names, or organisation names drawn from the knowledge base —
   use "StrategyDotZero", "SDZ", or "the platform" exclusively to name the provider.

━━━ HARD RULES ━━━
- NEVER use "we", "our", "us", or "ours". Refer to the organisation as "StrategyDotZero", "SDZ", or "the platform".
- Write in fluent third-person professional prose. Do NOT copy chunk text verbatim.
- Do NOT include source file names anywhere in your response text or JSON.
- MINIMUM LENGTH: every non-empty option must be at least 2 sentences and at least 20 words.
  Use all available detail from the source evidence to meet this requirement.
- Return ONLY the JSON object below — no markdown, no code fences, no preamble.

{
  "compliance": "Yes|Partial|No|?",
  "confidence": <integer 0-100>,
  "response": "...",
  "option2": "...",
  "option3": "..."
}

Confidence guidance:
- 85-100: [Compliance:] tag present AND response text clearly confirms the verdict
- 65-84: strong textual evidence but no explicit tag, or tag present with minor ambiguity
- 40-64: evidence partially addresses the requirement or sources conflict
- 0-39: weak or indirect evidence, significant uncertainty`;

  try {
    const raw  = await callGemini(prompt);
    const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(json);

    const rawConfidence = parseInt(String(parsed.confidence ?? '50'), 10);

    let response = String(parsed.response ?? '').trim();
    let option2  = String(parsed.option2  ?? '').trim();
    let option3  = String(parsed.option3  ?? '').trim();

    // Minimum length: regenerate any option that is under 40 words (one attempt only)
    const MIN_WORDS = 20;
    const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

    async function expandIfShort(text: string, evidence: string, label: string): Promise<string> {
      if (!text || wordCount(text) >= MIN_WORDS) return text;
      console.log(`[Compliance] ${label} is ${wordCount(text)} words — expanding.`);
      const expandPrompt = `Expand this into a more complete response using all available detail from the source evidence. Keep the same meaning and facts, write at least 2 sentences and at least 20 words, use fluent third-person professional prose.

CURRENT TEXT:
${text}

SOURCE EVIDENCE:
${evidence}

Return ONLY the expanded text — no preamble, no labels, no JSON.`;
      try {
        const expanded = (await callGemini(expandPrompt)).trim();
        console.log(`[Compliance] ${label} expanded to ${wordCount(expanded)} words.`);
        return expanded;
      } catch (err) {
        console.error(`[Compliance] Expand failed for ${label}:`, err);
        return text;
      }
    }

    const evidenceByLabel: Record<string, string> = {};
    docOptions.forEach((d, i) => {
      evidenceByLabel[['response', 'option2', 'option3'][i] ?? `opt${i}`] = d.chunk.content;
    });

    response = await expandIfShort(response, evidenceByLabel['response'] ?? '', 'response');
    option2  = await expandIfShort(option2,  evidenceByLabel['option2']  ?? '', 'option2');
    option3  = await expandIfShort(option3,  evidenceByLabel['option3']  ?? '', 'option3');

    // Client-name check: sanitise on first hit (one retry per option)
    if (containsClientReference(response))
      response = await sanitiseOption(response, requirement, 'response');
    if (containsClientReference(option2))
      option2  = await sanitiseOption(option2,  requirement, 'option2');
    if (containsClientReference(option3))
      option3  = await sanitiseOption(option3,  requirement, 'option3');

    return {
      compliance: VALID_STATUSES.includes(parsed.compliance)
                    ? (parsed.compliance as ComplianceStatus) : '?',
      confidence: isNaN(rawConfidence) ? 50 : Math.max(0, Math.min(100, rawConfidence)),
      response,
      option2,
      option3,
    };
  } catch (err) {
    console.error('[Compliance] Gemini synthesis failed, falling back to raw content:', err);
    return {
      compliance: inferCompliance(docOptions[0]?.chunk.score ?? 0),
      confidence: 25,
      response:   docOptions[0]?.chunk.content ?? '',
      option2:    docOptions[1]?.chunk.content ?? '',
      option3:    docOptions[2]?.chunk.content ?? '',
    };
  }
}

// ─── Row builder ─────────────────────────────────────────────────────────────

export async function buildComplianceRows(requirements: string[]): Promise<ComplianceRow[]> {
  const rows: ComplianceRow[] = [];

  for (let i = 0; i < requirements.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400)); // throttle embedding calls

    const req        = requirements[i];
    const options    = await searchForRequirement(req);

    // Debug: print top-5 retrieved chunks so mismatches are visible in server logs
    console.log(`[Compliance] Req ${i + 1}: "${req.slice(0, 70)}${req.length > 70 ? '…' : ''}"`);
    options.slice(0, 5).forEach((o, idx) => {
      const tag = o.content.match(/\[Compliance:\s*(.*?)\]/i)?.[1] ?? '—';
      const req = o.requirementText ? ` | KBReq: "${o.requirementText}"` : '';
      console.log(`  ${idx + 1}. [${(o.score * 100).toFixed(0)}%] [${tag}] ${o.docName}${req}`);
    });

    // Gate: if even the best chunk is below threshold, no useful evidence exists.
    if (options.length === 0 || options[0].score < 0.20) {
      rows.push({
        reqNum:      i + 1,
        requirement: req,
        compliant:   '?',
        confidence:  0,
        response:    'No historical response found — manual input required.',
        option2:     '',
        option3:     '',
        sources:     '',
      });
      continue;
    }

    // Select top-3 distinct documents (Fix 4) — sources come from here, not Gemini (Fix 2).
    const docOptions         = selectTopDocOptions(options);
    const synthesis          = await synthesiseWithGemini(req, docOptions);
    const weightedCompliance = weightedComplianceFromTopChunks(options);

    // Fix 1: if no tagged chunks were found, fall back to Gemini's verdict
    //         (with primacy enforcement as a safety net).
    const finalCompliance: ComplianceStatus = weightedCompliance
      ? weightedCompliance.verdict
      : enforceTopChunkPrimacy(synthesis.compliance, docOptions);

    if (weightedCompliance) {
      console.log(
        `[Compliance] Weighted tagged-chunks score: ${weightedCompliance.score.toFixed(3)} → ${weightedCompliance.verdict}`,
      );
    } else {
      console.log(
        `[Compliance] No tagged chunks in top-5 — using Gemini verdict: ${finalCompliance}`,
      );
    }

    // Source attribution is derived from chunk metadata, never from Gemini output.
    const sources = docOptions
      .map((d, idx) => `Opt ${idx + 1}: ${d.docName}`)
      .join('\n');

    rows.push({
      reqNum:      i + 1,
      requirement: req,
      compliant:   finalCompliance,
      confidence:  synthesis.confidence,
      response:    synthesis.response,
      option2:     synthesis.option2,
      option3:     synthesis.option3,
      sources,
    });
  }

  return rows;
}
