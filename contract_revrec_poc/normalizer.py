from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from schema_validator import CanonicalContract, LineItem


def _is_na_text(s: str) -> bool:
  v = s.strip().upper()
  return v in {"N/A", "NA", "NONE", "NULL", "—", "-"}


def normalize_text_field(v: Any) -> str:
  if v is None:
    return ""
  if isinstance(v, str):
    return "" if _is_na_text(v) else v.strip()
  return str(v).strip()


def _looks_like_included(line_item: LineItem) -> bool:
  if line_item.included:
    return True
  blob = f"{line_item.fee_type} {line_item.description} {line_item.notes}".lower()
  if "included" in blob:
    # Conservative: only mark included when description indicates no separate charge.
    # If "charge" is present, keep as-is.
    if "charge" not in blob and "fee" not in blob:
      return True
  return False


def classify_fee_type(line_item: LineItem) -> str:
  if line_item.fee_type:
    return line_item.fee_type
  blob = f"{line_item.description} {line_item.notes}".lower()
  if any(k in blob for k in ["subscription", "software", "platform", "application", "recurring"]):
    return "subscription"
  if any(k in blob for k in ["support", "maintenance"]):
    return "support"
  if any(k in blob for k in ["implementation", "onboarding", "setup", "upgrade", "upgrade fee", "kickoff"]):
    return "one_time"
  if any(k in blob for k in ["credit", "discount", "rebate"]):
    return "discount"
  return "other"


def _normalize_yes_no(v: Any) -> str:
  if isinstance(v, bool):
    return "Y" if v else "N"
  s = normalize_text_field(v)
  if not s:
    return ""
  low = s.lower()

  if low in {"y", "yes", "true", "1"}:
    return "Y"
  if low in {"n", "no", "false", "0"}:
    return "N"

  if any(x in low for x in ["not required", "no purchase order", "po not required", "optional", "not needed"]):
    return "N"
  if "required" in low or re.search(r"\byes\b", low):
    return "Y"
  return ""


def _flatten_table_text(tables: Optional[List[Dict[str, Any]]]) -> str:
  if not tables:
    return ""
  lines: List[str] = []
  for table in tables[:40]:
    rows = table.get("rows") if isinstance(table, dict) else None
    if not isinstance(rows, list):
      continue
    for row in rows[:30]:
      if not isinstance(row, list):
        continue
      cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
      if cells:
        lines.append(" | ".join(cells))
  return "\n".join(lines)


def _extract_po_number(text: str) -> str:
  if not text:
    return ""

  patterns = [
    r"\b(?:purchase\s*order|po)\s*(?:number|no\.?|#)\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-_/\.]{1,64})",
    r"\bpo#\s*([A-Za-z0-9][A-Za-z0-9\-_/\.]{1,64})",
  ]

  for pat in patterns:
    m = re.search(pat, text, flags=re.IGNORECASE)
    if not m:
      continue
    candidate = m.group(1).strip().strip(".,;:")
    if not candidate:
      continue
    if re.fullmatch(r"[_\-.]{2,}", candidate):
      continue
    if re.search(r"if\s+available", candidate, flags=re.IGNORECASE):
      continue
    return candidate

  return ""

def _extract_contract_id(text: str) -> str:
  """
  Best-effort deterministic extraction for contract identifiers.
  This is a fallback for cases where the LLM returns an empty `contract_header.contract_id`.
  """
  if not text:
    return ""

  patterns = [
    # Common formats: "Order Form No. 12", "Order No. 2", "Order Form #: 2"
    r"\border\s*(?:form\s*)?(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_/\.]{0,64})",
    # Some docs use "Contract ID"
    r"\bcontract\s*id\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-_/\.]{0,64})",
  ]

  for pat in patterns:
    m = re.search(pat, text, flags=re.IGNORECASE)
    if not m:
      continue
    candidate = (m.group(1) or "").strip().strip(".,;:").strip()
    if not candidate:
      continue
    if re.fullmatch(r"[_\-.]{2,}", candidate):
      continue
    return candidate

  return ""


def _infer_po_required_from_text(raw_text: str, table_text: str) -> str:
  source = "\n".join([raw_text or "", table_text or ""]).strip()
  if not source:
    return ""

  compact = re.sub(r"\s+", " ", source)
  contexts: List[str] = []
  for m in re.finditer(r"\b(?:purchase\s*order|po)\b", compact, flags=re.IGNORECASE):
    start = max(0, m.start() - 140)
    end = min(len(compact), m.end() + 260)
    contexts.append(compact[start:end])

  if not contexts:
    return ""

  yes_score = 0
  no_score = 0

  for c in contexts[:40]:
    if re.search(r"\[\s*[xX✓✔]\s*\]\s*yes\b", c, flags=re.IGNORECASE):
      yes_score += 5
    if re.search(r"\[\s*[xX✓✔]\s*\]\s*no\b", c, flags=re.IGNORECASE):
      no_score += 5

    if re.search(r"\b(?:purchase\s*order|po)\b.{0,40}\b(?:is\s+|are\s+|be\s+)?required\b", c, flags=re.IGNORECASE):
      yes_score += 3
    if re.search(r"\brequires?\s+(?:a\s+)?(?:purchase\s*order|po)\b", c, flags=re.IGNORECASE):
      yes_score += 3
    if re.search(r"\byes\s*(?:-|–|:)\s*please\s+complete\b", c, flags=re.IGNORECASE):
      yes_score += 2

    if re.search(r"\bno\s+(?:purchase\s*order|po)\s+required\b", c, flags=re.IGNORECASE):
      no_score += 3
    if re.search(r"\b(?:purchase\s*order|po)\b.{0,50}\b(?:not required|is not required|optional|not needed|not necessary)\b", c, flags=re.IGNORECASE):
      no_score += 3
    if re.search(r"\b(?:without|no)\s+(?:purchase\s*order|po)\b", c, flags=re.IGNORECASE):
      no_score += 2

  if yes_score == 0 and no_score == 0:
    return ""
  if yes_score >= no_score + 1:
    return "Y"
  if no_score >= yes_score + 1:
    return "N"
  return ""


def normalize_canonical_contract(
  contract: CanonicalContract,
  *,
  raw_text: str = "",
  tables: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
  """
  Conservative normalization after schema validation.
  - Converts "included" items into pricing amounts of 0.
  - Normalizes text fields (N/A => '').
  - If fee_type is missing, fills it using conservative heuristics.
  """
  contract_dict = contract.model_dump()

  ch = contract_dict.get("contract_header", {})
  for k, v in list(ch.items()):
    if isinstance(v, str):
      ch[k] = normalize_text_field(v)

  # Fallback: if the LLM failed to populate contract_id, try to parse it directly.
  if not ch.get("contract_id"):
    ch["contract_id"] = _extract_contract_id(raw_text or "")

  ct = contract_dict.get("commercial_terms", {})
  for k, v in list(ct.items()):
    if isinstance(v, str):
      ct[k] = normalize_text_field(v)

  table_text = _flatten_table_text(tables)
  po_required = _normalize_yes_no(ct.get("po_required", ""))
  po_number = normalize_text_field(ct.get("po_number", ""))

  if not po_required:
    po_required = _infer_po_required_from_text(raw_text, table_text)
  if not po_number:
    po_number = _extract_po_number("\n".join([raw_text or "", table_text or ""]))
  if not po_required and po_number:
    # If a PO number is explicitly provided, PO is effectively required in practice.
    po_required = "Y"

  ct["po_required"] = po_required
  ct["po_number"] = po_number

  for li in contract_dict.get("line_items", []):
    # Ensure included items are represented as zero-dollar pricing.
    li_model = LineItem.model_validate(li)
    if _looks_like_included(li_model):
      li["included"] = True
      if li.get("unit_price") is not None:
        li["unit_price"] = 0.0
      if isinstance(li.get("pricing"), list):
        for p in li["pricing"]:
          if isinstance(p, dict):
            p["amount"] = 0.0
    li["fee_type"] = classify_fee_type(LineItem.model_validate(li))

    li["source_section"] = normalize_text_field(li.get("source_section", ""))
    li["category"] = normalize_text_field(li.get("category", ""))
    li["description"] = normalize_text_field(li.get("description", ""))
    li["user_type"] = normalize_text_field(li.get("user_type", ""))
    li["pricing_model"] = normalize_text_field(li.get("pricing_model", ""))
    li["notes"] = normalize_text_field(li.get("notes", ""))

  for t in contract_dict.get("totals", []):
    if isinstance(t, dict):
      t["label"] = normalize_text_field(t.get("label", ""))
      t["period_label"] = normalize_text_field(t.get("period_label", ""))

  pm = contract_dict.get("parsing_metadata", {})
  if isinstance(pm, dict):
    pm["contract_type_guess"] = normalize_text_field(pm.get("contract_type_guess", ""))
    # Ensure notes are strings.
    pm["confidence_notes"] = [str(x) for x in pm.get("confidence_notes", []) if x is not None]
    pm["unmapped_sections"] = [str(x) for x in pm.get("unmapped_sections", []) if x is not None]

  return contract_dict

