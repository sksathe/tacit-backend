from __future__ import annotations

import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from openpyxl import Workbook
from openpyxl.utils import get_column_letter


def _set_col_width(ws, col_idx: int, width: int) -> None:
  ws.column_dimensions[get_column_letter(col_idx)].width = width


def _parse_date(date_str: str) -> Optional[datetime]:
  if not date_str:
    return None
  try:
    return datetime.strptime(date_str, "%Y-%m-%d")
  except Exception:
    return None


def _add_months(d: datetime, months: int) -> datetime:
  # Simple month addition keeping day=1 end-of-month logic via subtract 1 day.
  year = d.year + (d.month - 1 + months) // 12
  month = (d.month - 1 + months) % 12 + 1
  # Go to first day of target month then subtract 1 day.
  first_of_target = datetime(year, month, 1)
  return first_of_target - timedelta(days=1)


def _add_months_preserve_day(d: datetime, months: int) -> datetime:
  year = d.year + (d.month - 1 + months) // 12
  month = (d.month - 1 + months) % 12 + 1
  day = d.day

  if month == 12:
    next_month_first = datetime(year + 1, 1, 1)
  else:
    next_month_first = datetime(year, month + 1, 1)
  last_day = (next_month_first - timedelta(days=1)).day

  return datetime(year, month, min(day, last_day))


def _extract_first_int(s: str) -> Optional[int]:
  if not s:
    return None
  m = re.search(r"(\d{1,6})", s)
  if not m:
    return None
  try:
    return int(m.group(1))
  except Exception:
    return None


def _extract_percent_decimal(s: str) -> Optional[float]:
  """
  Extracts first percent-like number and returns decimal (e.g., '3%' -> 0.03).
  If the source number appears without '%', return it as-is (but still as float).
  """
  if not s:
    return None
  m = re.search(r"(\d+(?:\.\d+)?)\s*%", s)
  if m:
    try:
      return float(m.group(1)) / 100.0
    except Exception:
      return None
  m2 = re.search(r"(\d+(?:\.\d+)?)", s)
  if m2:
    try:
      return float(m2.group(1))
    except Exception:
      return None
  return None


def write_excel_workbook(*, canonical_contract: Dict[str, Any], raw_extracted: Dict[str, Any], output_xlsx_path: str) -> None:
  """
  Create a clean Excel workbook aligned with the reference template:
  - `Notes` sheet with a few review notes
  - `Rev Rec Datapoints` sheet with fixed 30 columns

  This is intentionally deterministic and reviewable, not PDF-like.
  """
  contract_header: Dict[str, Any] = canonical_contract.get("contract_header") or {}
  commercial_terms: Dict[str, Any] = canonical_contract.get("commercial_terms") or {}
  line_items: List[Dict[str, Any]] = canonical_contract.get("line_items") or []
  totals: List[Dict[str, Any]] = canonical_contract.get("totals") or []
  parsing_metadata: Dict[str, Any] = canonical_contract.get("parsing_metadata") or {}

  # Totals period labels, used to derive Subscription Term / yearly row windows.
  period_labels = [t.get("period_label") for t in totals if isinstance(t, dict) and t.get("period_label")]
  period_labels = [str(x) for x in period_labels]
  if not period_labels:
    seen = set()
    for li in line_items:
      for p in li.get("pricing") or []:
        if not isinstance(p, dict):
          continue
        label = str(p.get("period_label") or "").strip()
        if label and label not in seen:
          seen.add(label)
          period_labels.append(label)
  if not period_labels:
    period_labels = ["Year 1"]

  period_total_map: Dict[str, float] = {}
  for t in totals:
    if not isinstance(t, dict):
      continue
    label = str(t.get("period_label") or "").strip()
    if not label:
      continue
    amt = t.get("amount")
    try:
      period_total_map[label] = float(amt) if amt is not None else 0.0
    except Exception:
      period_total_map[label] = 0.0

  def _line_item_amount_for_period(li: Dict[str, Any], period_label: str) -> float:
    for p in li.get("pricing") or []:
      if not isinstance(p, dict):
        continue
      if str(p.get("period_label") or "").strip() != period_label:
        continue
      try:
        return float(p.get("amount") or 0.0)
      except Exception:
        return 0.0
    return 0.0

  year_totals: List[float] = []
  for label in period_labels:
    if label in period_total_map:
      year_totals.append(period_total_map[label])
    else:
      computed = 0.0
      for li in line_items:
        computed += _line_item_amount_for_period(li, label)
      year_totals.append(computed)

  subscription_start = _parse_date(str(contract_header.get("subscription_start_date", "")))
  subscription_end = _parse_date(str(contract_header.get("subscription_end_date", "")))
  term_months = contract_header.get("term_months")
  try:
    term_months_int = int(term_months) if term_months is not None else None
  except Exception:
    term_months_int = None

  # Derive subscription term from number of pricing periods when possible.
  subscription_term_months: Optional[int] = None
  if term_months_int and len(period_labels) > 0:
    subscription_term_months = int(round(term_months_int / len(period_labels)))
  if (subscription_term_months is None or subscription_term_months <= 0) and len(period_labels) > 1:
    subscription_term_months = 12

  # Currency
  currency = str(contract_header.get("currency") or "").strip()

  cancellation_days = None
  opt_out_flag = ""
  opt_out_terms = str(commercial_terms.get("opt_out_terms") or "")
  if opt_out_terms:
    # Prefer the number of days in "90 days written notice".
    m_days = re.search(r"(\d{1,6})\s*days", opt_out_terms, flags=re.IGNORECASE)
    cancellation_days = int(m_days.group(1)) if m_days else None
    if re.search(r"\bopt[-\s]?out\b", opt_out_terms, flags=re.IGNORECASE):
      # Match the reference workbook behavior: when the clause is expressed as
      # a timed notice ("90 days"), treat the workbook "Opt out" flag as N.
      opt_out_flag = "N" if cancellation_days is not None else "Y"

  payment_days = None
  payment_terms = str(commercial_terms.get("payment_terms") or "")
  if payment_terms:
    # Prefer "Net XX days" extraction.
    m = re.search(r"Net\s*(\d{1,6})", payment_terms, flags=re.IGNORECASE)
    payment_days = int(m.group(1)) if m else _extract_first_int(payment_terms)

  po_required_raw = str(commercial_terms.get("po_required") or "").strip()
  po_number = str(commercial_terms.get("po_number") or "").strip()
  po_required = ""
  if po_required_raw:
    low = po_required_raw.lower()
    if low in {"y", "yes", "true", "1"} or "required" in low:
      po_required = "Y"
    elif low in {"n", "no", "false", "0"} or any(x in low for x in ["not required", "optional", "not needed"]):
      po_required = "N"

  if not po_required:
    fallback_text = str(raw_extracted.get("raw_text") or "")
    if re.search(r"\b(?:purchase\s*order|po)\b.{0,50}\b(?:is\s+|are\s+|be\s+)?required\b", fallback_text, flags=re.IGNORECASE):
      po_required = "Y"
    elif re.search(r"\b(?:purchase\s*order|po)\b.{0,60}\b(?:not required|optional)\b", fallback_text, flags=re.IGNORECASE):
      po_required = "N"

  if not po_required and po_number:
    po_required = "Y"

  invoicing_terms = ""
  invoice_schedule = str(commercial_terms.get("invoice_schedule") or "")
  if invoice_schedule:
    # Conservative mapping for the reference-like workbook.
    if re.search(r"upon signing", invoice_schedule, flags=re.IGNORECASE):
      invoicing_terms = "Annual-On signature"

  renewal_pricing = _extract_percent_decimal(str(commercial_terms.get("renewal_terms") or ""))
  auto_renewal = ""
  renewal_terms = str(commercial_terms.get("renewal_terms") or "")
  if renewal_terms:
    if re.search(r"automatically[\s-]*renew\w*", renewal_terms, flags=re.IGNORECASE):
      auto_renewal = "Y"
    elif re.search(r"\beach\s+year\b", renewal_terms, flags=re.IGNORECASE) and re.search(r"\brenew\b", renewal_terms, flags=re.IGNORECASE):
      auto_renewal = "Y"

  # Excel fixed headers as in your reference workbook.
  headers = [
    "Contract_ID",
    "Customer_Name",
    "Signature_Date",
    "Contract Start Date",
    "Contract End Date",
    "Start_Date",
    "End_Date",
    "Contract term",
    "Subscription Term",
    "Currency",
    "Total Contract",
    "total annual price",
    "Price",
    "PO_Required",
    "Product type",
    "Product",
    "Milestone",
    "System Location",
    "RevRec_Method",
    "Cancellation_Terms",
    "Termination_for_Convenience",
    "Opt out",
    "Promised future product pricing (Y/N)",
    "Free work (Y/N)",
    "Contract modification (Y/N)",
    "Payment Terms",
    "Invoicing Terms",
    "Renewal Pricing",
    "Auto-renewal",
    "Renewal Term",
  ]

  # Create workbook
  wb = Workbook()

  # Notes sheet
  ws_notes = wb.active
  if ws_notes is None:
    ws_notes = wb.create_sheet("Notes")
  ws_notes.title = "Notes"
  ws_notes.cell(row=1, column=1, value="")
  ws_notes.cell(row=2, column=1, value="Notes:")

  notes = []
  unmapped_sections = parsing_metadata.get("unmapped_sections") or []
  contract_type_guess = parsing_metadata.get("contract_type_guess") or ""
  if contract_type_guess:
    notes.append(f"contract_type_guess: {contract_type_guess}")
  if isinstance(unmapped_sections, list) and len(unmapped_sections) > 0:
    notes.append(f"unmapped_sections_count: {len(unmapped_sections)}")
  if not notes:
    notes = [
      "milestones treat as products",
      "Salesforce data points vs contract elements.. TBD",
    ]
  # Write up to 3 notes lines similar to reference.
  for i, n in enumerate(notes[:3], start=3):
    ws_notes.cell(row=i, column=1, value=str(n))
  _set_col_width(ws_notes, 1, 48)

  # Rev Rec Datapoints sheet
  ws = wb.create_sheet("Rev Rec Datapoints")

  # Header row in reference is row 3.
  header_row = 3
  for c, h in enumerate(headers, start=1):
    ws.cell(row=header_row, column=c, value=h)
    _set_col_width(ws, c, 22 if c < 12 else 26)

  # Contract ID formatting as in reference: "Order Form No. X"
  contract_id = str(contract_header.get("contract_id") or "").strip()
  contract_id_formatted = f"Order Form No. {contract_id}" if contract_id else ""

  total_contract_formula = ""
  if len(year_totals) > 0:
    # Prefer numeric constants like the reference workbook.
    total_contract_formula = "=" + "+".join([str(int(x)) if float(x).is_integer() else str(x) for x in year_totals if x is not None])

  subscription_end_str = subscription_end.strftime("%Y-%m-%d") if subscription_end else ""

  period_total_by_label = {label: year_totals[idx] for idx, label in enumerate(period_labels)}

  # Fill datapoint rows: one row per (line item x period).
  data_start_row = header_row + 1
  row_idx = data_start_row
  for period_index, period_label in enumerate(period_labels):
    if subscription_start and subscription_term_months:
      period_start_dt = _add_months_preserve_day(subscription_start, period_index * subscription_term_months)
      period_start_str = period_start_dt.strftime("%Y-%m-%d")
      period_end_str = _add_months(period_start_dt.replace(day=1), subscription_term_months).strftime("%Y-%m-%d")
    else:
      period_start_str = subscription_start.strftime("%Y-%m-%d") if subscription_start else ""
      period_end_str = subscription_end_str

    total_annual_price = period_total_by_label.get(period_label, 0.0)

    for li in line_items:
      price_val_f = _line_item_amount_for_period(li, period_label)

      # Product type + Product
      product_type = str(li.get("category") or "")
      product_name = str(li.get("description") or "")

      # RevRec_Method: conservative placeholder (policy mapping comes later)
      revrec_method = ""  # do not guess
      if li.get("fee_type"):
        # reference uses "None"; we keep it blank unless we can map later.
        revrec_method = "" if str(li.get("fee_type")).lower() in {"none", "unknown"} else str(li.get("fee_type"))

      cancellation_val = cancellation_days if cancellation_days is not None else ""
      payment_val = payment_days if payment_days is not None else ""

      ws.cell(row=row_idx, column=1, value=contract_id_formatted)
      ws.cell(row=row_idx, column=2, value=contract_header.get("customer_name", ""))
      ws.cell(row=row_idx, column=3, value=contract_header.get("effective_date", ""))  # Signature_Date unknown in schema
      ws.cell(row=row_idx, column=4, value=subscription_start.strftime("%Y-%m-%d") if subscription_start else "")
      ws.cell(row=row_idx, column=5, value=subscription_end.strftime("%Y-%m-%d") if subscription_end else "")
      ws.cell(row=row_idx, column=6, value=period_start_str)
      ws.cell(row=row_idx, column=7, value=period_end_str)
      ws.cell(row=row_idx, column=8, value=term_months_int if term_months_int is not None else "")
      ws.cell(row=row_idx, column=9, value=subscription_term_months if subscription_term_months is not None else "")
      ws.cell(row=row_idx, column=10, value=currency)
      ws.cell(row=row_idx, column=11, value=total_contract_formula if total_contract_formula else None)
      ws.cell(row=row_idx, column=12, value=total_annual_price)
      ws.cell(row=row_idx, column=13, value=price_val_f)
      ws.cell(row=row_idx, column=14, value=po_required if po_required else None)
      ws.cell(row=row_idx, column=15, value=product_type)
      ws.cell(row=row_idx, column=16, value=product_name)
      ws.cell(row=row_idx, column=17, value="NA")  # Milestone not in schema; reference uses NA
      ws.cell(row=row_idx, column=18, value="")  # System Location not in canonical schema
      ws.cell(row=row_idx, column=19, value=revrec_method or None)
      ws.cell(row=row_idx, column=20, value=cancellation_val)
      ws.cell(row=row_idx, column=21, value="")  # Termination_for_Convenience unknown
      ws.cell(row=row_idx, column=22, value=opt_out_flag if opt_out_flag else None)
      ws.cell(row=row_idx, column=23, value="")  # promised future product pricing
      ws.cell(row=row_idx, column=24, value="")  # free work
      ws.cell(row=row_idx, column=25, value="")  # contract modification
      ws.cell(row=row_idx, column=26, value=payment_val)
      ws.cell(row=row_idx, column=27, value=invoicing_terms)
      ws.cell(row=row_idx, column=28, value=renewal_pricing if renewal_pricing is not None else "")
      ws.cell(row=row_idx, column=29, value=auto_renewal)
      ws.cell(row=row_idx, column=30, value=subscription_term_months if subscription_term_months is not None else "")

      row_idx += 1

  out_path = Path(output_xlsx_path)
  out_path.parent.mkdir(parents=True, exist_ok=True)
  wb.save(str(out_path))

