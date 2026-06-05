import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(
  __dirname,
  '../../tacit-frontend/public/labcorp-samples/tacit_data/CS-ULTRA-24R_CentraSpin/01_Product_Requirements_Document.txt',
);

const { ingestUploadedFile, inferDocumentCategory } = await import('../dist/services/manuIngest.js');

const buffer = readFileSync(samplePath);
const file = {
  originalname: '01_Product_Requirements_Document.txt',
  mimetype: 'text/plain',
  buffer,
};

const doc = await ingestUploadedFile(file);
console.log('inferDocumentCategory:', inferDocumentCategory(file.originalname));
console.log('ingest result:', {
  fileName: doc.fileName,
  category: doc.category,
  extractionStatus: doc.extractionStatus,
  textLength: doc.extractedText.length,
  confidence: doc.parsingConfidence,
});

if (doc.category !== 'prd' || doc.extractionStatus !== 'complete' || doc.extractedText.length < 50) {
  console.error('Smoke test FAILED');
  process.exit(1);
}

console.log('Smoke test PASSED');
