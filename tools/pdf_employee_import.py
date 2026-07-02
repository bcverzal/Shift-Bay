"""
Extract employee names and phone numbers from a text-based PDF into CSV.

Usage:
    python tools/pdf_employee_import.py "employees.pdf" "employees_import.csv"

The output CSV can be imported in the scheduler with Import Employees.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path


PHONE_RE = re.compile(
    r"(?:\+?1[\s.\-]?)?(?:\(?\d{3}\)?[\s.\-]?)\d{3}[\s.\-]?\d{4}"
)


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return value.strip()


def clean_name(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip(" ,-:\t")
    value = re.sub(r"\b(phone|cell|mobile|employee|server|host|busser)\b", "", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip(" ,-:\t")


def split_name(value: str) -> tuple[str, str]:
    value = clean_name(value)
    if "," in value:
        last, first = [part.strip() for part in value.split(",", 1)]
        return first, last
    parts = value.split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


def extract_text(pdf_path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise SystemExit(
            "This helper needs pypdf for PDF text extraction.\n"
            "Install it with: python -m pip install pypdf\n"
            "Then run this command again."
        ) from exc

    reader = PdfReader(str(pdf_path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def extract_employees(text: str) -> list[dict[str, str]]:
    employees: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for raw_line in text.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line:
            continue
        match = PHONE_RE.search(line)
        if not match:
            continue
        phone = normalize_phone(match.group(0))
        name_text = clean_name(line[: match.start()] or line[match.end() :])
        first, last = split_name(name_text)
        if not first and not last:
            continue
        key = (first.lower(), last.lower(), phone)
        if key in seen:
            continue
        seen.add(key)
        employees.append({"First Name": first, "Last Name": last, "Phone": phone})
    return employees


def write_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["First Name", "Last Name", "Phone"])
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip())
        return 2
    pdf_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}")
        return 1
    rows = extract_employees(extract_text(pdf_path))
    write_csv(rows, output_path)
    print(f"Wrote {len(rows)} employees to {output_path}")
    if not rows:
        print("No names with phone numbers were found. The PDF may be scanned or formatted unusually.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
