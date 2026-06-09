from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv
from pydantic import ValidationError

from excel_writer import write_excel_workbook
from llm_parser import parse_contract_with_openai, repair_contract_json_with_openai
from normalizer import normalize_canonical_contract
from pdf_extractor import extract_document
from schema_validator import validate_canonical_contract


def _write_json(path: Path, data: Any) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
  load_dotenv()

  parser = argparse.ArgumentParser(description="Contract PDF -> canonical JSON -> Excel proof of concept")
  parser.add_argument("--input", required=True, help="Path to input PDF contract")
  parser.add_argument("--out-dir", default="output", help="Output folder for Excel/JSON")
  parser.add_argument("--debug-dir", default="debug", help="Output folder for debug artifacts")
  parser.add_argument("--llm-model", default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
  parser.add_argument("--max-retries", type=int, default=int(os.getenv("LLM_MAX_RETRIES", "3")))
  parser.add_argument("--max-text-chars", type=int, default=int(os.getenv("LLM_MAX_TEXT_CHARS", "20000")))
  args = parser.parse_args()

  input_path = Path(args.input)
  out_dir = Path(args.out_dir)
  debug_dir = Path(args.debug_dir)
  out_dir.mkdir(parents=True, exist_ok=True)
  debug_dir.mkdir(parents=True, exist_ok=True)

  openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
  if not openai_api_key:
    raise RuntimeError("Missing OPENAI_API_KEY in environment. Copy .env.example to .env and set it.")

  # Optional per-run prompt configuration (set by the backend for this POC).
  extra_instructions_raw = os.getenv("LLM_EXTRA_INSTRUCTIONS", "").strip()
  extra_instructions = extra_instructions_raw if extra_instructions_raw else None

  schema_hint_override: Dict[str, Any] | None = None
  schema_hint_override_raw = os.getenv("LLM_SCHEMA_HINT_OVERRIDE_JSON", "").strip()
  if schema_hint_override_raw:
    try:
      parsed = json.loads(schema_hint_override_raw)
      if isinstance(parsed, dict):
        schema_hint_override = parsed
    except Exception:
      schema_hint_override = None

  # 1) PDF ingestion + extraction
  extracted = extract_document(
    str(input_path),
    max_chars_per_page=8000,
    max_tables_per_page=5,
    max_rows_per_table=50,
  )

  _write_json(debug_dir / "page_content.json", extracted.page_text)
  _write_json(debug_dir / "tables.json", extracted.tables)
  (debug_dir / "raw_text.txt").write_text(extracted.raw_text, encoding="utf-8")

  # 2) LLM semantic parsing -> canonical JSON (shape-first)
  llm_raw = parse_contract_with_openai(
    extracted_text=extracted.raw_text,
    tables=extracted.tables,
    openai_api_key=openai_api_key,
    model=args.llm_model,
    debug_dir=debug_dir,
    max_retries=args.max_retries,
    max_text_chars=args.max_text_chars,
    extra_instructions=extra_instructions,
    schema_hint_override=schema_hint_override,
  )
  _write_json(debug_dir / "llm_output.json", llm_raw)

  # 3) Schema validation
  canonical_obj: Dict[str, Any] = llm_raw
  try:
    validated = validate_canonical_contract(canonical_obj)
  except ValidationError as ve:
    _write_json(debug_dir / "validation_errors.json", {"errors": ve.errors()})
    # 4) Retry/fallback repair (only when schema validation fails)
    repaired = repair_contract_json_with_openai(
      invalid_json=json.dumps(llm_raw, ensure_ascii=False),
      validation_error=str(ve),
      extracted_text=extracted.raw_text,
      tables=extracted.tables,
      openai_api_key=openai_api_key,
      model=args.llm_model,
      debug_dir=debug_dir,
      max_retries=2,
      extra_instructions=extra_instructions,
      schema_hint_override=schema_hint_override,
    )
    _write_json(debug_dir / "llm_output_repaired.json", repaired)
    validated = validate_canonical_contract(repaired)

  # 5) Python normalization + conservative cleanup
  normalized_dict = normalize_canonical_contract(
    validated,
    raw_text=extracted.raw_text,
    tables=extracted.tables,
  )
  _write_json(debug_dir / "normalized.json", normalized_dict)

  # 6) Excel generation (deterministic mapping)
  output_xlsx_path = str(out_dir / "extracted_contract.xlsx")
  write_excel_workbook(
    canonical_contract=normalized_dict,
    raw_extracted={
      "raw_text": extracted.raw_text,
      "page_text": extracted.page_text,
      "tables": extracted.tables,
    },
    output_xlsx_path=output_xlsx_path,
  )

  # Also dump normalized JSON for review.
  _write_json(out_dir / "normalized_contract.json", normalized_dict)
  print(f"Generated Excel workbook: {output_xlsx_path}")


if __name__ == "__main__":
  main()

