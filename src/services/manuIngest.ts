import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { randomUUID } from 'crypto';
import type { ManuDocumentCategory, ManuUploadedDocument } from '../types/manu.js';

const MAX_EXTRACT_CHARS = 4000;

export function inferDocumentCategory(fileName: string): ManuDocumentCategory {
  const n = fileName.toLowerCase();
  if (/requirements|prd/.test(n)) return 'prd';
  if (/engineering|design.?spec|test.?report|assay/.test(n)) return 'engineering_test';
  if (/fmea|risk/.test(n)) return 'fmea';
  if (/regulatory|certification|submission/.test(n)) return 'regulatory';
  if (/manual|ifu/.test(n) && !/translat/.test(n)) return 'existing_manual';
  if (/translat|locale|_es_|_fr_|_de_/.test(n)) return 'translation';
  if (/verif|valid|clinical|quality|vv/.test(n)) return 'quality_validation';
  if (/label/.test(n)) return 'labeling';
  return 'other';
}

function truncateText(text: string, max = MAX_EXTRACT_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n…[truncated]';
}

async function extractPdfText(buffer: Buffer): Promise<{ text: string; status: 'complete' | 'partial'; confidence: number }> {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    const text = (parsed.text || '').trim();
    if (text.length < 200) {
      return {
        text: text || '[PDF text layer sparse — limited extraction available]',
        status: 'partial',
        confidence: 0.55,
      };
    }
    return { text: truncateText(text), status: 'complete', confidence: 0.88 };
  } catch {
    return {
      text: '[PDF extraction failed — upload a text-based PDF or provide TXT/CSV source]',
      status: 'partial',
      confidence: 0.4,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocxText(buffer: Buffer): Promise<{ text: string; status: 'complete' | 'partial'; confidence: number }> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    if (!text) {
      return { text: '[DOCX contained no extractable text]', status: 'partial', confidence: 0.5 };
    }
    return { text: truncateText(text), status: 'complete', confidence: 0.86 };
  } catch {
    return { text: '[DOCX extraction failed]', status: 'partial', confidence: 0.4 };
  }
}

export async function ingestUploadedFile(
  file: Express.Multer.File,
  categoryOverride?: ManuDocumentCategory,
): Promise<ManuUploadedDocument> {
  const fileName = file.originalname || 'upload';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const category = categoryOverride ?? inferDocumentCategory(fileName);
  const buffer = file.buffer;

  let extractedText = '';
  let extractionStatus: ManuUploadedDocument['extractionStatus'] = 'simulated';
  let parsingConfidence = 0.75;

  if (['txt', 'csv', 'md', 'json'].includes(ext) || file.mimetype.startsWith('text/')) {
    extractedText = truncateText(buffer.toString('utf-8'));
    extractionStatus = 'complete';
    parsingConfidence = ext === 'csv' ? 0.92 : 0.88;
  } else if (ext === 'pdf' || file.mimetype === 'application/pdf') {
    const pdf = await extractPdfText(buffer);
    extractedText = pdf.text;
    extractionStatus = pdf.status;
    parsingConfidence = pdf.confidence;
  } else if (ext === 'docx' || file.mimetype.includes('wordprocessingml')) {
    const docx = await extractDocxText(buffer);
    extractedText = docx.text;
    extractionStatus = docx.status;
    parsingConfidence = docx.confidence;
  } else {
    extractedText = `[Unsupported format: ${ext || file.mimetype}. Provide PDF, DOCX, TXT, or CSV.]`;
    extractionStatus = 'failed';
    parsingConfidence = 0.3;
  }

  return {
    id: `doc-${randomUUID()}`,
    fileName,
    fileType: file.mimetype || ext || 'application/octet-stream',
    category,
    uploadedAt: new Date().toISOString(),
    extractedText,
    extractionStatus,
    parsingConfidence,
    notes: '',
  };
}

export function buildDocumentBundleSummary(documents: ManuUploadedDocument[]): string {
  return documents
    .map((d) => `--- ${d.fileName} [${d.category}] ---\n${d.extractedText}`)
    .join('\n\n');
}
