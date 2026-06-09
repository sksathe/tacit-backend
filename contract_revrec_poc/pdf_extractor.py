from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF
import pdfplumber


@dataclass
class ExtractedDocument:
  raw_text: str
  page_text: List[Dict[str, Any]]
  tables: List[Dict[str, Any]]
  metadata: Dict[str, Any]


def extract_page_text_pymupdf(pdf_path: Path, max_chars_per_page: int = 8000) -> List[Dict[str, Any]]:
  doc = fitz.open(str(pdf_path))
  pages: List[Dict[str, Any]] = []
  for i in range(doc.page_count):
    page = doc.load_page(i)
    text = page.get_text("text") or ""
    text = text.strip()
    if len(text) > max_chars_per_page:
      text = text[:max_chars_per_page] + "\n...[truncated]"
    pages.append(
      {
        "page_number": i + 1,
        "text": text,
      }
    )
  return pages


def _clean_cell(v: Any) -> Optional[str]:
  if v is None:
    return None
  if isinstance(v, str):
    s = v.strip()
    return s if s else None
  # Some extractors return numbers/bools
  return str(v).strip() or None


def extract_tables_pdfplumber(pdf_path: Path, max_tables_per_page: int = 5, max_rows: int = 50) -> List[Dict[str, Any]]:
  tables_out: List[Dict[str, Any]] = []
  with pdfplumber.open(str(pdf_path)) as pdf:
    for page_idx, page in enumerate(pdf.pages):
      page_number = page_idx + 1
      # pdfplumber's table detection may be slow; keep it bounded.
      try:
        table_settings = {
          "vertical_strategy": "lines",
          "horizontal_strategy": "lines",
          "intersection_tolerance": 5,
          "snap_tolerance": 3,
          "join_tolerance": 3,
          "edge_min_length": 3,
          "min_words_vertical": 1,
          "min_words_horizontal": 1,
        }
        detected = page.find_tables(table_settings=table_settings)
      except Exception:
        detected = []

      for t_idx, table in enumerate(detected[:max_tables_per_page]):
        try:
          table_data = table.extract()
        except Exception:
          continue

        # Normalize into rows
        rows: List[List[Optional[str]]] = []
        for r_i, row in enumerate(table_data or []):
          if r_i >= max_rows:
            rows.append([f"...[truncated rows]"])
            break
          rows.append([_clean_cell(c) for c in (row or [])])

        tables_out.append(
          {
            "page_number": page_number,
            "table_index": t_idx,
            "rows": rows,
          }
        )

  return tables_out


def extract_document(
  pdf_path: str,
  *,
  max_chars_per_page: int = 8000,
  max_tables_per_page: int = 5,
  max_rows_per_table: int = 50,
) -> ExtractedDocument:
  path = Path(pdf_path)
  if not path.exists():
    raise FileNotFoundError(f"Input PDF not found: {pdf_path}")

  page_text = extract_page_text_pymupdf(path, max_chars_per_page=max_chars_per_page)
  tables = extract_tables_pdfplumber(path, max_tables_per_page=max_tables_per_page, max_rows=max_rows_per_table)

  raw_text_parts: List[str] = []
  for p in page_text:
    raw_text_parts.append(f"--- Page {p['page_number']} ---\n{p['text']}")
  raw_text = "\n\n".join(raw_text_parts)

  metadata = {
    "file_name": path.name,
    "file_size_bytes": path.stat().st_size,
    "page_count": len(page_text),
    "tables_detected": len(tables),
  }

  return ExtractedDocument(raw_text=raw_text, page_text=page_text, tables=tables, metadata=metadata)

