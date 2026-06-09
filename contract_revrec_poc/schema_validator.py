from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_numeric_input(v: Any) -> Optional[float]:
  """
  Accepts numbers or numeric strings (including parentheses negatives like "(50,000)").
  Returns None if conversion is not possible.
  """
  if v is None:
    return None
  if isinstance(v, (int, float)) and not isinstance(v, bool):
    return float(v)
  if isinstance(v, str):
    s = v.strip()
    if not s:
      return None
    upper = s.upper()
    if upper in {"N/A", "NA", "NONE", "NULL", "-"}:
      return None

    # Parentheses negative: (50,000) => -50000
    negative = False
    if s.startswith("(") and s.endswith(")"):
      negative = True
      s = s[1:-1]

    # Remove currency symbols and whitespace, keep digits and separators.
    cleaned = s.replace(",", "")
    cleaned = cleaned.replace("$", "").replace("€", "").replace("£", "").strip()

    try:
      num = float(cleaned)
    except ValueError:
      return None
    return -num if negative else num
  return None


class ContractHeader(BaseModel):
  model_config = ConfigDict(extra="forbid")

  contract_id: str = ""
  customer_name: str = ""
  vendor: str = ""
  order_form_type: str = ""
  agreement_reference: str = ""
  effective_date: str = ""
  subscription_start_date: str = ""
  subscription_end_date: str = ""
  term_months: Optional[int] = None
  currency: str = ""


  @field_validator("term_months", mode="before")
  @classmethod
  def _coerce_term_months(cls, v: Any) -> Optional[int]:
    n = _normalize_numeric_input(v)
    if n is None:
      return None
    return int(round(n))


class CommercialTerms(BaseModel):
  model_config = ConfigDict(extra="forbid")

  billing_frequency: str = ""
  payment_terms: str = ""
  renewal_terms: str = ""
  opt_out_terms: str = ""
  invoice_schedule: str = ""
  po_required: str = ""
  po_number: str = ""


class PricingPeriod(BaseModel):
  model_config = ConfigDict(extra="forbid")

  period_label: str = ""
  amount: Optional[float] = None

  @field_validator("amount", mode="before")
  @classmethod
  def _coerce_amount(cls, v: Any) -> Optional[float]:
    return _normalize_numeric_input(v)


class LineItem(BaseModel):
  model_config = ConfigDict(extra="forbid")

  source_section: str = ""
  category: str = ""
  description: str = ""
  user_type: str = ""
  quantity: Optional[float] = None
  unit_price: Optional[float] = None
  pricing_model: str = ""
  pricing: List[PricingPeriod] = Field(default_factory=list)
  fee_type: str = ""
  included: bool = False
  notes: str = ""

  @field_validator("quantity", "unit_price", mode="before")
  @classmethod
  def _coerce_line_numbers(cls, v: Any) -> Optional[float]:
    return _normalize_numeric_input(v)


class TotalEntry(BaseModel):
  model_config = ConfigDict(extra="forbid")

  label: str = ""
  period_label: str = ""
  amount: Optional[float] = 0

  @field_validator("amount", mode="before")
  @classmethod
  def _coerce_total_amount(cls, v: Any) -> Optional[float]:
    return _normalize_numeric_input(v) if v is not None else 0


class ParsingMetadata(BaseModel):
  model_config = ConfigDict(extra="forbid")

  contract_type_guess: str = ""
  confidence_notes: List[str] = Field(default_factory=list)
  unmapped_sections: List[str] = Field(default_factory=list)


class CanonicalContract(BaseModel):
  model_config = ConfigDict(extra="forbid")

  contract_header: ContractHeader
  commercial_terms: CommercialTerms
  line_items: List[LineItem] = Field(default_factory=list)
  totals: List[TotalEntry] = Field(default_factory=list)
  parsing_metadata: ParsingMetadata

  @field_validator("totals", mode="before")
  @classmethod
  def _coerce_totals(cls, v: Any) -> Any:
    return v if v is not None else []


def validate_canonical_contract(data: dict) -> CanonicalContract:
  """
  Strict schema validation (keys are forbidden if extra; required top-level keys must exist).
  Numeric values may be strings; those are normalized by field coercion helpers.
  """
  return CanonicalContract.model_validate(data)

