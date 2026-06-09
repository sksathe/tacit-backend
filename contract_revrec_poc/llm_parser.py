from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from openai import OpenAI


CANONICAL_SCHEMA_HINT: Dict[str, Any] = {
  "contract_header": {
    "contract_id": "",
    "customer_name": "",
    "vendor": "",
    "order_form_type": "",
    "agreement_reference": "",
    "effective_date": "",
    "subscription_start_date": "",
    "subscription_end_date": "",
    "term_months": None,
    "currency": "",
  },
  "commercial_terms": {
    "billing_frequency": "",
    "payment_terms": "",
    "renewal_terms": "",
    "opt_out_terms": "",
    "invoice_schedule": "",
    "po_required": "",
    "po_number": "",
  },
  "line_items": [
    {
      "source_section": "",
      "category": "",
      "description": "",
      "user_type": "",
      "quantity": None,
      "unit_price": None,
      "pricing_model": "",
      "pricing": [{"period_label": "Year 1", "amount": 0}],
      "fee_type": "",
      "included": False,
      "notes": "",
    }
  ],
  "totals": [
    {"label": "", "period_label": "", "amount": 0}
  ],
  "parsing_metadata": {
    "contract_type_guess": "",
    "confidence_notes": [],
    "unmapped_sections": [],
  },
}

def _schema_hint_matches_canonical_structure(override: Any, canonical: Any) -> bool:
  """
  Canonical-safe guard to prevent user-provided schema-hints from changing
  the required output JSON keys.
  """
  if isinstance(canonical, dict):
    if not isinstance(override, dict):
      return False
    canonical_keys = set(canonical.keys())
    override_keys = set(override.keys())
    if canonical_keys != override_keys:
      return False
    for k in canonical_keys:
      if not _schema_hint_matches_canonical_structure(override[k], canonical[k]):
        return False
    return True

  if isinstance(canonical, list):
    if not isinstance(override, list):
      return False
    if len(canonical) == 0:
      return True
    # If override provides an empty list, we still consider the structure compatible.
    if len(override) == 0:
      return True
    return _schema_hint_matches_canonical_structure(override[0], canonical[0])

  # Scalar leaves: we don't enforce value types in the schema hint.
  return True


def _summarize_tables(tables: List[Dict[str, Any]], max_tables: int = 30, max_rows_per_table: int = 8) -> List[Dict[str, Any]]:
  out: List[Dict[str, Any]] = []
  for t in tables[:max_tables]:
    rows = t.get("rows") or []
    truncated_rows = rows[:max_rows_per_table]
    out.append(
      {
        "page_number": t.get("page_number"),
        "table_index": t.get("table_index"),
        "rows": truncated_rows,
      }
    )
  return out


def _truncate_text(text: str, max_chars: int) -> str:
  if len(text) <= max_chars:
    return text
  return text[:max_chars] + "\n\n...[truncated]\n"


def _build_user_prompt(
  extracted_text: str,
  tables: List[Dict[str, Any]],
  *,
  schema_hint: Dict[str, Any],
  extra_instructions: Optional[str] = None,
) -> str:
  tables_hint = _summarize_tables(tables)
  additional = f"\nAdditional user instructions:\n{extra_instructions}\n" if extra_instructions else ""
  return (
    "You are a contract extraction engine.\n"
    "Task: Extract structured business and financial data from this customer contract/order form PDF.\n"
    "You must output STRICT JSON that matches the canonical schema keys exactly.\n"
    "Do not output markdown.\n"
    "Do not invent values. If uncertain or not found, use empty string '' or null as appropriate.\n"
    "\n"
    "Rules:\n"
    "- Preserve period labels as found in the source (e.g., monthly/quarterly/custom). Do not rename to only Year 1/2/3.\n"
    "- Line items: capture all recognizable product/service rows, including recurring fees, one-time fees, credits/discounts, and included services.\n"
    "- included:true means there is no additional charge; set all pricing[].amount to 0.\n"
    "- Convert number strings in source into numeric amounts. Parentheses negatives like (50,000) => -50000.\n"
    "- Convert N/A to null unless it's helpful as display text in notes.\n"
    "- Totals: capture totals found; output as totals[] entries. If multiple period totals exist, preserve period labels.\n"
    "- Purchase Order / PO: detect whether a PO is required from contract language or checkbox sections. Map to commercial_terms.po_required as 'Y' or 'N' when explicit, else ''.\n"
    "- Extract PO number into commercial_terms.po_number only when clearly present; otherwise ''.\n"
    "- Fee type classification guidance: subscription/software/support(standalone) => recurring; included support without separate charge => included=true; implementation/setup/onboarding => one_time unless clearly recurring; credits/discounts => discount; otherwise => other.\n"
    f"{additional}"
    "\n"
    "Canonical schema example (structure only):\n"
    f"{json.dumps(schema_hint, ensure_ascii=False, indent=2)}\n"
    "\n"
    "Extracted page-wise contract text:\n"
    f"{extracted_text}\n"
    "\n"
    "Extracted tables (truncated rows):\n"
    f"{json.dumps(tables_hint, ensure_ascii=False, indent=2)}\n"
  )


def parse_contract_with_openai(
  *,
  extracted_text: str,
  tables: List[Dict[str, Any]],
  openai_api_key: str,
  model: str,
  debug_dir: Optional[Path] = None,
  max_retries: int = 3,
  max_text_chars: int = 20000,
  extra_instructions: Optional[str] = None,
  schema_hint_override: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
  schema_hint_for_prompt = CANONICAL_SCHEMA_HINT
  if schema_hint_override is not None:
    if _schema_hint_matches_canonical_structure(schema_hint_override, CANONICAL_SCHEMA_HINT):
      schema_hint_for_prompt = schema_hint_override
    else:
      if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / "schema_hint_override_rejected.json").write_text(
          json.dumps(
            {"reason": "Override does not match canonical key structure", "schema_hint_override": schema_hint_override},
            ensure_ascii=False,
            indent=2,
          ),
          encoding="utf-8",
        )

  client = OpenAI(api_key=openai_api_key)
  user_text = _build_user_prompt(
    _truncate_text(extracted_text, max_text_chars),
    tables,
    schema_hint=schema_hint_for_prompt,
    extra_instructions=extra_instructions,
  )

  # JSON-only response to make parsing easier.
  system_prompt = (
    "You return only valid JSON. The output must parse with JSON.parse. "
    "It must contain exactly the keys required by the canonical schema example structure."
  )

  last_err: Optional[Exception] = None
  for attempt in range(1, max_retries + 1):
    try:
      resp = client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[
          {"role": "system", "content": system_prompt},
          {"role": "user", "content": user_text},
        ],
        response_format={"type": "json_object"},
      )

      content = resp.choices[0].message.content or ""
      if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / f"llm_output_raw_attempt_{attempt}.json").write_text(content, encoding="utf-8")

      data = json.loads(content)
      if not isinstance(data, dict):
        raise ValueError("LLM output is not a JSON object")
      return data
    except Exception as e:  # noqa: BLE001
      last_err = e
      if debug_dir:
        (debug_dir / f"llm_error_attempt_{attempt}.txt").write_text(str(e), encoding="utf-8")
      # Backoff on rate limits and transient errors.
      time.sleep(1.0 * attempt)

  raise RuntimeError(f"OpenAI parsing failed after {max_retries} attempts: {last_err}")


def repair_contract_json_with_openai(
  *,
  invalid_json: str,
  validation_error: str,
  extracted_text: str,
  tables: List[Dict[str, Any]],
  openai_api_key: str,
  model: str,
  debug_dir: Optional[Path] = None,
  max_retries: int = 2,
  max_text_chars: int = 15000,
  extra_instructions: Optional[str] = None,
  schema_hint_override: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
  """
  Fallback path when the LLM output parses as JSON but fails schema validation.
  We ask the model to correct the JSON to match the canonical schema keys.
  """
  client = OpenAI(api_key=openai_api_key)
  last_err: Optional[Exception] = None

  schema_hint_for_prompt = CANONICAL_SCHEMA_HINT
  if schema_hint_override is not None:
    if _schema_hint_matches_canonical_structure(schema_hint_override, CANONICAL_SCHEMA_HINT):
      schema_hint_for_prompt = schema_hint_override
    else:
      if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / "schema_hint_override_rejected_repair.json").write_text(
          json.dumps(
            {"reason": "Override does not match canonical key structure", "schema_hint_override": schema_hint_override},
            ensure_ascii=False,
            indent=2,
          ),
          encoding="utf-8",
        )

  additional = f"\nAdditional user instructions:\n{extra_instructions}\n" if extra_instructions else ""

  # Keep the prompt focused to reduce token usage.
  base_user = (
    "You returned JSON that failed schema validation.\n"
    f"Validation error:\n{validation_error}\n\n"
    "Fix the JSON so it matches the canonical schema keys and types.\n"
    "Do not add extra top-level keys.\n"
    "Return only valid JSON."
    f"{additional}\n"
    "\nCanonical schema example (structure only):\n"
    f"{json.dumps(schema_hint_for_prompt, ensure_ascii=False, indent=2)}\n"
  )

  tables_hint = _summarize_tables(tables)
  user_text = (
    base_user
    + "\n\nInvalid JSON you produced:\n"
    + invalid_json
    + "\n\nExtracted page-wise text:\n"
    + _truncate_text(extracted_text, max_text_chars)
    + "\n\nExtracted tables (truncated rows):\n"
    + json.dumps(tables_hint, ensure_ascii=False, indent=2)
  )

  system_prompt = (
    "Return only valid JSON. It must parse with JSON.parse and contain exactly the required keys."
  )

  for attempt in range(1, max_retries + 1):
    try:
      resp = client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[
          {"role": "system", "content": system_prompt},
          {"role": "user", "content": user_text},
        ],
        response_format={"type": "json_object"},
      )

      content = resp.choices[0].message.content or ""
      if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        (debug_dir / f"llm_repair_output_attempt_{attempt}.json").write_text(content, encoding="utf-8")
      data = json.loads(content)
      if not isinstance(data, dict):
        raise ValueError("Repair output is not a JSON object")
      return data
    except Exception as e:  # noqa: BLE001
      last_err = e
      if debug_dir:
        (debug_dir / f"llm_repair_error_attempt_{attempt}.txt").write_text(str(e), encoding="utf-8")
      time.sleep(0.8 * attempt)

  raise RuntimeError(f"Repair failed after {max_retries} attempts: {last_err}")


