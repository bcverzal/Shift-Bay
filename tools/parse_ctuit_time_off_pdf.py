import base64
import datetime as dt
import json
import re
import sys
import uuid
from pathlib import Path

import pdfplumber


DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
STATUS_RE = re.compile(r"\b(Active|Pending|Denied|Canceled|Cancelled)\b", re.I)
TIME_RANGE_RE = re.compile(r"(\d{1,2}:\d{2}\s*[AP]M)\s+to\s+(\d{1,2}:\d{2}\s*[AP]M)", re.I)


def clean(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def date_key(value):
    match = DATE_RE.search(clean(value))
    if not match:
        return ""
    month, day, year = (int(part) for part in match.groups())
    return dt.date(year, month, day).isoformat()


def split_name(value):
    text = clean(value).strip(", ")
    if "," in text:
        last, first = [clean(part) for part in text.split(",", 1)]
        return first, last
    parts = text.split()
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


def request_daypart(info):
    text = clean(info)
    if re.search(r"\bAll\s+Day\b", text, re.I):
        return "All day"
    match = TIME_RANGE_RE.search(text)
    if match:
        return f"{match.group(1).upper()} to {match.group(2).upper()}"
    return ""


def row_request(row, file_name):
    cells = [clean(cell) for cell in row]
    if len(cells) < 7:
        return None
    if not cells[2] or not cells[3] or not cells[4]:
        return None
    if cells[2].lower() in {"employee", "employee name"}:
        return None
    date = date_key(cells[3]) or date_key(cells[4])
    if not date:
        return None
    first, last = split_name(cells[2])
    if not first and not last:
        return None
    status = ""
    approved_by = cells[6]
    status_match = STATUS_RE.search(" ".join(cells[4:]))
    if status_match:
        status = status_match.group(1).title()
    note = cells[5]
    if status and note.lower().endswith(status.lower()):
        note = clean(note[: -len(status)])
    return {
        "firstName": first,
        "lastName": last,
        "date": date,
        "daypart": request_daypart(cells[4]),
        "note": note,
        "status": status,
        "approvedBy": approved_by,
        "recurring": cells[1],
        "source": f"Ctuit RO PDF: {file_name}",
    }


def parse_pdf(path, file_name):
    requests = []
    pages = 0
    table_rows = 0
    with pdfplumber.open(str(path)) as pdf:
        pages = len(pdf.pages)
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    table_rows += 1
                    request = row_request(row, file_name)
                    if request:
                        requests.append(request)
    return {
        "fileName": file_name,
        "pages": pages,
        "tableRows": table_rows,
        "requests": requests,
    }


def main():
    payload = json.load(sys.stdin)
    results = []
    errors = []
    scratch_root = Path(__file__).resolve().parents[1] / "data" / "import-temp"
    scratch_root.mkdir(parents=True, exist_ok=True)
    for index, item in enumerate(payload.get("files", [])):
        name = clean(item.get("name")) or f"request-off-{index + 1}.pdf"
        pdf_path = scratch_root / f"{uuid.uuid4().hex}-{index}.pdf"
        try:
            raw = base64.b64decode(item.get("dataBase64") or "")
            pdf_path.write_bytes(raw)
            results.append(parse_pdf(pdf_path, name))
        except Exception as exc:
            errors.append({"fileName": name, "error": str(exc)})
        finally:
            try:
                pdf_path.unlink(missing_ok=True)
            except Exception:
                pass
    all_requests = []
    seen = set()
    duplicates = 0
    for result in results:
        for request in result["requests"]:
            key = (
                request["firstName"].lower(),
                request["lastName"].lower(),
                request["date"],
                request["daypart"].lower(),
                request["note"].lower(),
            )
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            all_requests.append(request)
    print(json.dumps({
        "requests": all_requests,
        "source": "Ctuit RO PDF",
        "diagnostics": {
            "files": results,
            "errors": errors,
            "duplicates": duplicates,
        },
    }))


if __name__ == "__main__":
    main()
