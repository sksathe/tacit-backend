import { config } from 'dotenv';

// Ensure env is loaded when this module is imported directly (mostly redundant with index.ts but safe)
config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

if (!OPENAI_API_KEY) {
  console.warn('⚠️ OPENAI_API_KEY is not set. Summary generation will fail until it is configured in server-api/.env');
}

export interface GeneratedSummary {
  model: string;
  summary_text: string;
  key_points: string[];
  action_items: string[];
}

export interface SummaryGenerationOptions {
  tone?: string;
  audience?: string;
  instructions?: string;
}

export interface ClarityDimension {
  id: string;
  label: string;
  emoji: string;
  score: number;
  /** 1–3 short bullets explaining strengths. */
  whyHigh: string[];
  /** 1–3 short bullets explaining weaknesses. */
  whyLow: string[];
}

export interface ClarityScoreResult {
  model: string;
  title: string;
  /** One-paragraph narrative summary for text-oriented UIs. */
  summary: string;
  dimensions: ClarityDimension[];
  overallScore: number;
  overallLabel: string;
  /** 2–5 short bullets that synthesize the clarity story. */
  interpretation: string[];
}

export interface ClarityScoreOptions {
  /**
   * Optional free-form steering instructions from the caller.
   * This can nudge style or emphasis but must never override grounding rules.
   */
  instructions?: string;
}

export interface FinancialConceptMapOptions {
  instructions?: string;
  tone?: string;
  audience?: string;
  visualMode?: 'standard' | 'illustrative';
}

interface FinancialConceptMapSection {
  label: string;
  items: string[];
}

interface FinancialConceptMapFlow {
  from: string;
  to: string;
  label?: string;
}

interface FinancialConceptMapSpec {
  title: string;
  subtitle: string;
  objective: string;
  central_system: string;
  sections: FinancialConceptMapSection[];
  pain_points: string[];
  solutions: string[];
  next_steps: string[];
  flows: FinancialConceptMapFlow[];
}

export interface FinancialConceptMapResult {
  model: string;
  image_data_url: string;
  prompt_used: string;
  visual_spec: FinancialConceptMapSpec;
}

interface Soc2ControlMapping {
  criteria: string;
  control_objective: string;
  evidence_from_transcript: string[];
  status: 'covered' | 'partial' | 'not_specified';
  gaps: string[];
}

export interface Soc2DocumentResult {
  model: string;
  document_title: string;
  report_date: string;
  system_description: string;
  scope: {
    in_scope: string[];
    out_of_scope: string[];
    boundaries: string[];
  };
  trust_services_categories: string[];
  control_mappings: Soc2ControlMapping[];
  evidence_inventory: string[];
  remediation_plan: string[];
  management_assertion_draft: string;
  auditor_notes: string[];
  disclaimer: string;
}

export interface Soc2DocumentOptions {
  tone?: string;
  audience?: string;
  instructions?: string;
}

interface ComplianceFinding {
  area: string;
  status: 'good' | 'bad' | 'partial' | 'not_specified';
  evidence_from_transcript: string[];
  impact: string;
  recommendation: string;
}

export interface ComplianceGapAnalysisResult {
  model: string;
  title: string;
  summary: string;
  strengths: string[];
  gaps: string[];
  findings: ComplianceFinding[];
  priority_actions: string[];
  future_steps: string[];
  disclaimer: string;
}

export interface ComplianceGapAnalysisOptions {
  tone?: string;
  audience?: string;
  instructions?: string;
}

/**
 * Generate a summary from a transcript JSON using OpenAI.
 * The transcript is passed as JSON; the model returns a structured JSON object.
 * Optional options (tone, audience, instructions) let the caller steer the style.
 */
export async function generateSummaryFromTranscriptRaw(
  rawTranscript: any,
  options?: SummaryGenerationOptions
): Promise<GeneratedSummary> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured for the server API');
  }

  const tone = options?.tone?.trim();
  const audience = options?.audience?.trim();
  const extraInstructions = options?.instructions?.trim();

  const toneLine = tone ? `Use a ${tone} tone.\n` : '';
  const audienceLine = audience ? `Write for this audience: ${audience}.\n` : '';
  const extraLine = extraInstructions ? `Additional instructions from the user: ${extraInstructions}\n` : '';

  const prompt = `You are a senior note-taker and knowledge curator.
You will receive a transcript of a knowledge capture call as JSON.

Your job is to:
- Write a concise executive summary (3-6 sentences).
- Extract 3-10 key points (short bullet-style items).
- Extract 0-10 action items, each with a short description.

CRITICAL CONSTRAINTS:
- You must only use information that is explicitly present in the transcript JSON.
- Do NOT invent or infer new facts, numbers, names, dates, companies, or metrics.
- If the transcript does not specify something, say that it is \"not specified in the transcript\" instead of guessing.
- Do NOT bring in any outside knowledge or assumptions beyond what the transcript says.
- Paraphrasing is allowed, but all content must be grounded in the transcript.

Styling hints (optional; follow only if consistent with the transcript):
${toneLine}${audienceLine}${extraLine}

Return ONLY a JSON object with this shape:
{
  "summary_text": string,
  "key_points": string[],
  "action_items": string[]
}

Do not include any additional keys or commentary.`;

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Here is the transcript JSON:\n\n${JSON.stringify(rawTranscript, null, 2)}`,
      },
    ],
    response_format: { type: 'json_object' as const },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI API error (${response.status}): ${text || response.statusText}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned no content for summary');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error('Failed to parse OpenAI summary JSON');
  }

  return {
    model: LLM_MODEL,
    summary_text: String(parsed.summary_text ?? ''),
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items.map(String) : [],
  };
}

/**
 * Generate a "Clarity Scorer" style report from a transcript JSON using
 * the same OpenAI model as summaries.
 *
 * This is intentionally fancy and presentation-ready: it uses emojis,
 * headings, scored dimensions, and short narrative interpretation.
 *
 * CRITICAL: The model must rely ONLY on what is explicitly present
 * in the transcript JSON – no external facts or speculation.
 */
export async function generateClarityScoreFromTranscriptRaw(
  rawTranscript: any,
  options?: ClarityScoreOptions
): Promise<ClarityScoreResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured for the server API');
  }

  const extraInstructions = options?.instructions?.trim();

  const extraLine = extraInstructions
    ? `Additional optional steering from the user (do NOT override grounding rules): ${extraInstructions}\n`
    : '';

  const prompt = `You are an expert facilitator evaluating how clearly a conversation communicates its ideas.
You will receive the transcript of a call as JSON. You are not judging the *quality* of the ideas,
only how clearly they are articulated in the transcript itself.

You must analyze clarity strictly based on what is explicitly present in the transcript. If something
important is missing or vague in the transcript, call that out as a clarity weakness.

You are generating data for a UI that will show **cards** for each clarity dimension with:
- A label and emoji.
- A 0–100 score.
- 1–3 very short bullet points for "why high" and 1–3 very short bullet points for "why low".

You MUST return a single JSON object with this exact shape:
{
  "title": string,
  "summary": string,            // 2-4 sentences, transcript-grounded narrative
  "dimensions": [
    {
      "id": string,              // e.g., "operational_clarity"
      "label": string,           // e.g., "Operational Clarity"
      "emoji": string,           // e.g., "1️⃣"
      "score": number,           // integer 0–100
      "whyHigh": string[],       // 1–3 SHORT bullets (<= 120 chars each) for strengths
      "whyLow": string[]         // 1–3 SHORT bullets (<= 120 chars each) for weaknesses
    },
    ...
  ],
  "overallScore": number,       // integer 0–100
  "overallLabel": string,       // short phrase, e.g., "Strong operational clarity, weaker governance detail"
  "interpretation": string[]    // 2–5 SHORT bullets (<= 160 chars each) synthesizing the clarity picture
}

Content rules:
- Use 2–3 dimensions. Good defaults:
  - Operational Clarity
  - Governance / Control Clarity
  - (Optional) Communication Hygiene or Stakeholder Alignment
- Scores must be integers between 0 and 100 (no decimals).
- Every bullet MUST be grounded in specific evidence from the transcript:
  - Reference things like "explicitly defines X", "never specifies Y", "declines to describe Z".
- Be **strictly grounded in the transcript JSON**. Do NOT invent or assume policies, metrics,
  regulations, or governance structures that are not described in the transcript.
- Do NOT mention that you are an AI model, JSON, or your own process.
- If something is unclear or not specified, say so directly (e.g., "Override paths are not described
  anywhere in the transcript.").
- Keep bullets compact and skimmable; avoid long paragraphs.

${extraLine}
Return ONLY the JSON object, with no markdown, no code fences, and no extra commentary.`;

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Here is the transcript JSON:\n\n${JSON.stringify(rawTranscript, null, 2)}`,
      },
    ],
    response_format: { type: 'json_object' as const },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI API error (${response.status}) while generating clarity score: ${text || response.statusText}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAI returned no content for clarity score');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Failed to parse OpenAI clarity score JSON');
  }

  const dimensions: ClarityDimension[] = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.map((d: any, index: number) => ({
        id: String(d?.id ?? `dimension_${index + 1}`),
        label: String(d?.label ?? ''),
        emoji: String(d?.emoji ?? ''),
        score: typeof d?.score === 'number' ? d.score : Number(d?.score ?? 0),
        whyHigh: Array.isArray(d?.whyHigh) ? d.whyHigh.map((x: any) => String(x)) : [],
        whyLow: Array.isArray(d?.whyLow) ? d.whyLow.map((x: any) => String(x)) : [],
      }))
    : [];

  const interpretation: string[] = Array.isArray(parsed.interpretation)
    ? parsed.interpretation.map((x: any) => String(x))
    : [];

  return {
    model: LLM_MODEL,
    title: String(parsed.title ?? 'Clarity Score (Based Strictly on Transcript)'),
    summary: String(
      parsed.summary ??
      parsed.overview ??
      parsed.description ??
      parsed.notes ??
      ''
    ),
    dimensions,
    overallScore: typeof parsed.overallScore === 'number'
      ? parsed.overallScore
      : Number(parsed.overallScore ?? 0),
    overallLabel: String(parsed.overallLabel ?? ''),
    interpretation,
  };
}

/**
 * Generate a single "whiteboard sketchnote" financial concept-map image from transcript data.
 * This uses a two-step flow:
 * 1) Extract structured visual spec from transcript (strictly grounded).
 * 2) Render image from a style-locked prompt using gpt-image-1.
 */
export async function generateFinancialConceptMapFromTranscriptRaw(
  rawTranscript: any,
  options?: FinancialConceptMapOptions
): Promise<FinancialConceptMapResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured for the server API');
  }

  const tone = options?.tone?.trim();
  const audience = options?.audience?.trim();
  const extraInstructions = options?.instructions?.trim();
  const visualMode = options?.visualMode === 'illustrative' ? 'illustrative' : 'standard';

  const specPrompt = `You are a product architect creating a structured visual blueprint from a meeting transcript JSON.
Your output will be used to render a whiteboard-style concept map.

Grounding requirements:
- Use only facts explicitly present in the transcript JSON.
- Do not invent tools, systems, labels, numbers, or timelines.
- If unknown, use short placeholders like "Not specified".

Output requirements:
- Return only JSON with this exact shape:
{
  "title": string,
  "subtitle": string,
  "objective": string,
  "central_system": string,
  "sections": [{"label": string, "items": string[]}],
  "pain_points": string[],
  "solutions": string[],
  "next_steps": string[],
  "flows": [{"from": string, "to": string, "label": string}]
}
- Keep labels short (2-6 words).
- Keep each section <= 4 items.
- Keep pain_points, solutions, next_steps to <= 4 each.
- Prefer 4-7 sections total.

Optional style context from user:
${tone ? `- Tone: ${tone}` : '- Tone: professional'}
${audience ? `- Audience: ${audience}` : '- Audience: executive + technical'}
${extraInstructions ? `- Additional instructions: ${extraInstructions}` : '- Additional instructions: none'}
`;

  const specBody = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: specPrompt },
      {
        role: 'user',
        content: `Transcript JSON:\n\n${JSON.stringify(rawTranscript, null, 2)}`,
      },
    ],
    response_format: { type: 'json_object' as const },
  };

  const specResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(specBody),
  });

  if (!specResponse.ok) {
    const text = await specResponse.text().catch(() => '');
    throw new Error(`OpenAI API error (${specResponse.status}) while generating concept-map spec: ${text || specResponse.statusText}`);
  }

  const specData: any = await specResponse.json();
  const specContent = specData?.choices?.[0]?.message?.content;
  if (!specContent) {
    throw new Error('OpenAI returned no content for concept-map spec');
  }

  let visualSpec: FinancialConceptMapSpec;
  try {
    const parsed: any = JSON.parse(specContent);
    visualSpec = {
      title: String(parsed?.title ?? 'Visual Concept Map'),
      subtitle: String(parsed?.subtitle ?? 'Transcript-grounded summary'),
      objective: String(parsed?.objective ?? 'Not specified'),
      central_system: String(parsed?.central_system ?? 'Core System'),
      sections: Array.isArray(parsed?.sections)
        ? parsed.sections.map((s: any) => ({
            label: String(s?.label ?? 'Section'),
            items: Array.isArray(s?.items) ? s.items.map((x: any) => String(x)).slice(0, 4) : [],
          })).slice(0, 7)
        : [],
      pain_points: Array.isArray(parsed?.pain_points) ? parsed.pain_points.map((x: any) => String(x)).slice(0, 4) : [],
      solutions: Array.isArray(parsed?.solutions) ? parsed.solutions.map((x: any) => String(x)).slice(0, 4) : [],
      next_steps: Array.isArray(parsed?.next_steps) ? parsed.next_steps.map((x: any) => String(x)).slice(0, 4) : [],
      flows: Array.isArray(parsed?.flows)
        ? parsed.flows.map((f: any) => ({
            from: String(f?.from ?? ''),
            to: String(f?.to ?? ''),
            label: String(f?.label ?? ''),
          })).slice(0, 10)
        : [],
    };
  } catch {
    throw new Error('Failed to parse concept-map visual spec JSON');
  }

  const sectionLines = visualSpec.sections
    .map((section) => `- ${section.label}: ${section.items.join(', ') || 'Not specified'}`)
    .join('\n');
  const painPointsLine = visualSpec.pain_points.join(', ') || 'Not specified';
  const solutionsLine = visualSpec.solutions.join(', ') || 'Not specified';
  const nextStepsLine = visualSpec.next_steps.join(', ') || 'Not specified';
  const flowLines = visualSpec.flows
    .map((flow) => `- ${flow.from} -> ${flow.to}${flow.label ? ` (${flow.label})` : ''}`)
    .join('\n');

  const modeStyleBlock = visualMode === 'illustrative'
    ? `Illustrative mode requirements (high visual richness):
- include decorative title ribbon and section ribbons
- include doodle-style icons near major labels (e.g., gears, clipboard, warning, locks, graph, user, boxes)
- include at least 10 distinct labeled visual elements
- include multiple callout boxes and curved arrows with arrowheads
- include subtle hand-drawn shadows, hatch strokes, and marker texture
- use a storytelling composition with 1 centerpiece + surrounding panels`
    : `Standard mode requirements:
- keep layout clean and readable with moderate visual decoration
- prioritize clarity of labels and section grouping over ornamentation`;

  const renderPrompt = `Create a single wide whiteboard sketchnote architecture diagram in a clean corporate visual-storytelling style.
Match this style precisely:
- hand-drawn marker outlines, sketch-note infographic aesthetic
- white background with subtle paper texture
- blue/teal primary accents with small orange highlights
- playful but professional cartoon components and icons
- curved directional arrows, section headers, callout boxes, banner title
- readable hand-lettered labels
- balanced composition with one central focal component and surrounding domains

${modeStyleBlock}

Diagram content to include:
Title: ${visualSpec.title}
Subtitle: ${visualSpec.subtitle}
Objective banner: ${visualSpec.objective}
Central component: ${visualSpec.central_system}

Sections and items:
${sectionLines}

Pain points:
${painPointsLine}

Solutions:
${solutionsLine}

Next steps:
${nextStepsLine}

Key flows:
${flowLines || '- Not specified'}

Layout requirements:
- 16:9 wide composition
- strong central anchor, left and right thematic groups
- labels must stay short and legible
- avoid clutter, no dense paragraphs

Negative constraints:
- no photorealism
- no dark background
- no generic 3D render style
- no purple-dominant palette`;

  async function generateImage(size?: string) {
    const imageBody: Record<string, unknown> = {
      model: 'gpt-image-1',
      prompt: renderPrompt,
      n: 1,
    };
    if (size) {
      imageBody.size = size;
    }

    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(imageBody),
    });

    if (!imageResponse.ok) {
      const text = await imageResponse.text().catch(() => '');
      throw new Error(`OpenAI API error (${imageResponse.status}) while generating concept-map image: ${text || imageResponse.statusText}`);
    }

    return imageResponse.json();
  }

  let imageData: any;
  try {
    imageData = await generateImage('1536x1024');
  } catch {
    // Fallback for environments/models that reject explicit wide sizes.
    imageData = await generateImage();
  }

  const b64 = imageData?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI returned no image data for concept map');
  }

  return {
    model: 'gpt-image-1',
    image_data_url: `data:image/png;base64,${b64}`,
    prompt_used: renderPrompt,
    visual_spec: visualSpec,
  };
}

export async function generateSoc2DocumentFromTranscriptRaw(
  rawTranscript: any,
  options?: Soc2DocumentOptions
): Promise<Soc2DocumentResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured for the server API');
  }

  const tone = options?.tone?.trim();
  const audience = options?.audience?.trim();
  const extraInstructions = options?.instructions?.trim();

  const prompt = `You are a SOC 2 readiness analyst.
You will receive a meeting transcript JSON and must produce a SOC 2-ready documentation draft.

CRITICAL GROUNDING RULES:
- Use only evidence explicitly present in the transcript.
- Do NOT invent controls, systems, policies, tool names, owners, dates, or metrics.
- If a control area is not described, mark it as "not_specified".
- This output must be useful for GRC platforms (e.g., Vanta/Drata) as an evidence-oriented draft.

Return ONLY a JSON object with this exact shape:
{
  "document_title": string,
  "report_date": string,
  "system_description": string,
  "scope": {
    "in_scope": string[],
    "out_of_scope": string[],
    "boundaries": string[]
  },
  "trust_services_categories": string[],
  "control_mappings": [
    {
      "criteria": string,
      "control_objective": string,
      "evidence_from_transcript": string[],
      "status": "covered" | "partial" | "not_specified",
      "gaps": string[]
    }
  ],
  "evidence_inventory": string[],
  "remediation_plan": string[],
  "management_assertion_draft": string,
  "auditor_notes": string[],
  "disclaimer": string
}

Requirements:
- Always include common SOC 2 areas in mappings when possible:
  CC1, CC2, CC3, CC4, CC5, CC6, CC7, CC8, CC9 and relevant Trust Services Categories.
- If transcript lacks data for an area, include it with status "not_specified".
- Keep statements specific and audit-friendly, not marketing language.
- management_assertion_draft should be 1 short paragraph.
- evidence_inventory should be concrete and upload-friendly names.

Optional style hints:
${tone ? `- Tone: ${tone}` : '- Tone: professional'}
${audience ? `- Audience: ${audience}` : '- Audience: compliance, audit, and security stakeholders'}
${extraInstructions ? `- Additional instructions: ${extraInstructions}` : '- Additional instructions: none'}
`;

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Here is the transcript JSON:\n\n${JSON.stringify(rawTranscript, null, 2)}`,
      },
    ],
    response_format: { type: 'json_object' as const },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI API error (${response.status}) while generating SOC2 document: ${text || response.statusText}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned no content for SOC2 document');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Failed to parse OpenAI SOC2 document JSON');
  }

  return {
    model: LLM_MODEL,
    document_title: String(parsed?.document_title ?? 'SOC 2 Readiness Documentation Draft'),
    report_date: String(parsed?.report_date ?? new Date().toISOString().slice(0, 10)),
    system_description: String(parsed?.system_description ?? 'Not specified in transcript.'),
    scope: {
      in_scope: Array.isArray(parsed?.scope?.in_scope) ? parsed.scope.in_scope.map((x: any) => String(x)) : [],
      out_of_scope: Array.isArray(parsed?.scope?.out_of_scope) ? parsed.scope.out_of_scope.map((x: any) => String(x)) : [],
      boundaries: Array.isArray(parsed?.scope?.boundaries) ? parsed.scope.boundaries.map((x: any) => String(x)) : [],
    },
    trust_services_categories: Array.isArray(parsed?.trust_services_categories)
      ? parsed.trust_services_categories.map((x: any) => String(x))
      : [],
    control_mappings: Array.isArray(parsed?.control_mappings)
      ? parsed.control_mappings.map((m: any) => ({
          criteria: String(m?.criteria ?? ''),
          control_objective: String(m?.control_objective ?? ''),
          evidence_from_transcript: Array.isArray(m?.evidence_from_transcript) ? m.evidence_from_transcript.map((x: any) => String(x)) : [],
          status: m?.status === 'covered' || m?.status === 'partial' || m?.status === 'not_specified' ? m.status : 'not_specified',
          gaps: Array.isArray(m?.gaps) ? m.gaps.map((x: any) => String(x)) : [],
        }))
      : [],
    evidence_inventory: Array.isArray(parsed?.evidence_inventory) ? parsed.evidence_inventory.map((x: any) => String(x)) : [],
    remediation_plan: Array.isArray(parsed?.remediation_plan) ? parsed.remediation_plan.map((x: any) => String(x)) : [],
    management_assertion_draft: String(parsed?.management_assertion_draft ?? ''),
    auditor_notes: Array.isArray(parsed?.auditor_notes) ? parsed.auditor_notes.map((x: any) => String(x)) : [],
    disclaimer: String(parsed?.disclaimer ?? 'This draft is transcript-grounded and requires formal compliance review before audit submission.'),
  };
}

export async function generateComplianceGapAnalysisFromTranscriptRaw(
  rawTranscript: any,
  options?: ComplianceGapAnalysisOptions
): Promise<ComplianceGapAnalysisResult> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured for the server API');
  }

  const tone = options?.tone?.trim();
  const audience = options?.audience?.trim();
  const extraInstructions = options?.instructions?.trim();

  const prompt = `You are a compliance analyst creating a gap-analysis report from a meeting transcript JSON.

CRITICAL RULES:
- Use only facts present in the transcript.
- Do NOT invent policies, controls, tools, owners, or audit evidence.
- Clearly separate what appears "good" vs "bad/gap" vs "future steps".
- If data is missing, mark as "not_specified".

Return ONLY JSON in this exact shape:
{
  "title": string,
  "summary": string,
  "strengths": string[],
  "gaps": string[],
  "findings": [
    {
      "area": string,
      "status": "good" | "bad" | "partial" | "not_specified",
      "evidence_from_transcript": string[],
      "impact": string,
      "recommendation": string
    }
  ],
  "priority_actions": string[],
  "future_steps": string[],
  "disclaimer": string
}

Guidance:
- strengths = what appears compliant/controlled based on transcript evidence
- gaps = major missing controls, ambiguity, or risk exposure
- future_steps = practical next steps for compliance readiness
- findings should be concise and audit-friendly

Optional style hints:
${tone ? `- Tone: ${tone}` : '- Tone: professional'}
${audience ? `- Audience: ${audience}` : '- Audience: compliance and operations stakeholders'}
${extraInstructions ? `- Additional instructions: ${extraInstructions}` : '- Additional instructions: none'}
`;

  const body = {
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Here is the transcript JSON:\n\n${JSON.stringify(rawTranscript, null, 2)}`,
      },
    ],
    response_format: { type: 'json_object' as const },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI API error (${response.status}) while generating compliance gap analysis: ${text || response.statusText}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned no content for compliance gap analysis');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Failed to parse OpenAI compliance gap analysis JSON');
  }

  return {
    model: LLM_MODEL,
    title: String(parsed?.title ?? 'Compliance Gap Analysis'),
    summary: String(parsed?.summary ?? ''),
    strengths: Array.isArray(parsed?.strengths) ? parsed.strengths.map((x: any) => String(x)) : [],
    gaps: Array.isArray(parsed?.gaps) ? parsed.gaps.map((x: any) => String(x)) : [],
    findings: Array.isArray(parsed?.findings)
      ? parsed.findings.map((f: any) => ({
          area: String(f?.area ?? ''),
          status: f?.status === 'good' || f?.status === 'bad' || f?.status === 'partial' || f?.status === 'not_specified'
            ? f.status
            : 'not_specified',
          evidence_from_transcript: Array.isArray(f?.evidence_from_transcript)
            ? f.evidence_from_transcript.map((x: any) => String(x))
            : [],
          impact: String(f?.impact ?? ''),
          recommendation: String(f?.recommendation ?? ''),
        }))
      : [],
    priority_actions: Array.isArray(parsed?.priority_actions) ? parsed.priority_actions.map((x: any) => String(x)) : [],
    future_steps: Array.isArray(parsed?.future_steps) ? parsed.future_steps.map((x: any) => String(x)) : [],
    disclaimer: String(parsed?.disclaimer ?? 'This report is transcript-grounded and requires formal compliance validation before regulatory reliance.'),
  };
}
