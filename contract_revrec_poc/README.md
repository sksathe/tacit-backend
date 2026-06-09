# Contract RevRec POC (Python)

This proof of concept ingests executed customer contracts (PDF order forms), extracts raw text + table-like structures, uses OpenAI to semantically parse and normalize into a canonical intermediate schema (strict JSON), validates + conservatively normalizes in Python, and finally writes a clean standardized Excel workbook for review.

## Architecture (as requested)
1. `pdf_extractor.py`  
   - PDF ingestion  
   - page-wise text extraction (PyMuPDF)  
   - table-like extraction where possible (pdfplumber)  
   - debug artifacts for raw text + extracted tables
2. `llm_parser.py`  
   - OpenAI semantic parsing into **strict canonical JSON**
   - retry + repair when JSON is malformed or fails schema validation
3. `schema_validator.py`  
   - Pydantic validation against the canonical schema
4. `normalizer.py`  
   - conservative normalization rules (N/A -> null/empty, included -> zero pricing, conservative fee-type fill)
5. `excel_writer.py`  
   - deterministic Excel workbook mapping into reviewable sheets
6. `main.py`  
   - orchestrates the full pipeline

## Canonical intermediate schema
The canonical contract object shape is implemented in `schema_validator.py` and includes:
- `contract_header`
- `commercial_terms`
- `line_items[]` with dynamic `pricing[]` period labels
- `totals[]`
- `parsing_metadata`

## Setup
1. Install Python 3.10+.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Configure environment:
   - Copy `.env.example` to `.env`
   - Set `OPENAI_API_KEY`

## Run
```bash
python main.py --input "path/to/your-contract.pdf" --out-dir output --debug-dir debug
```

### Outputs
After a successful run:
- `output/extracted_contract.xlsx`
- `output/normalized_contract.json`
- debug artifacts:
  - `debug/raw_text.txt`
  - `debug/page_content.json`
  - `debug/tables.json`
  - `debug/llm_output.json`
  - `debug/normalized.json`
  - `debug/validation_errors.json` (if any)

## Notes / Extensibility
- The system does not assume fixed PDF layout or fixed table row positions; OpenAI handles semantic parsing using both extracted page text and truncated table rows.
- Python validation + normalization is conservative: when uncertain, it uses `null`/empty rather than hallucinating.
- To add new contract types, you typically only need prompt/schema adjustments and (optionally) improved extraction heuristics in `pdf_extractor.py`.

## Example run against your MetricStream test contract
If you provide the exact PDF in your environment, the command is:
```bash
python main.py --input "INSERT_PATH_TO_YOUR_METRICSTREAM_ORDER_FORM.pdf" --out-dir output --debug-dir debug
```

