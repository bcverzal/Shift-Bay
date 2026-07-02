import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path

from read_biff_xls import OleFile, parse_biff, cells_to_rows


FOH_ROLE_ALIASES = {
    "SERVER": "Server",
    "BARTENDER": "Bartender",
    "BUSSER": "Busser",
    "HOST": "Host",
    "EXPO": "Expo",
    "BANQUET SERVER": "Banquet Server",
    "BANQUET": "Banquet Server",
}


def uid(prefix):
    return f"{prefix}_{int(dt.datetime.now().timestamp() * 1000):x}_{len(prefix)}"


def clean(value):
    return str(value or "").strip()


def norm_name(value):
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def split_name(value):
    text = clean(value)
    if "," in text:
        last, first = [clean(part) for part in text.split(",", 1)]
        return first, last
    parts = text.split()
    return (parts[0], " ".join(parts[1:])) if parts else ("", "")


def employee_tokens(employee):
    values = [
        f"{employee.get('firstName', '')} {employee.get('lastName', '')}",
        employee.get("firstName", ""),
        employee.get("nickname", ""),
    ]
    return {norm_name(value) for value in values if norm_name(value)}


def match_employee(employees, name):
    first, last = split_name(name)
    full = norm_name(f"{first} {last}")
    first_key = norm_name(first)
    last_key = norm_name(last)
    for employee in employees:
        if norm_name(f"{employee.get('firstName','')} {employee.get('lastName','')}") == full:
            return employee
    for employee in employees:
        if full and full in employee_tokens(employee):
            return employee
    for employee in employees:
        same_last = last_key and norm_name(employee.get("lastName", "")) == last_key
        first_matches = first_key and first_key in employee_tokens(employee)
        if same_last and first_matches:
            return employee
    return None


def normalize_time(value):
    text = clean(value).upper().replace(" ", "")
    match = re.match(r"^(\d{1,2})(?::(\d{2}))?([AP])M?$", text)
    if not match:
        return clean(value)
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    suffix = "AM" if match.group(3) == "A" else "PM"
    return f"{hour}:{minute:02d} {suffix}"


def parse_shift_time(value):
    parts = re.split(r"\s*[-–]\s*", clean(value), maxsplit=1)
    if len(parts) != 2:
        return "", ""
    return normalize_time(parts[0]), normalize_time(parts[1])


def parse_date_heading(value):
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", clean(value))
    if not match:
        return ""
    month, day, year = map(int, match.groups())
    return dt.date(year, month, day).isoformat()


def start_of_week(date_key, week_start):
    date = dt.date.fromisoformat(date_key)
    diff = (date.weekday() + 1 - int(week_start)) % 7
    return (date - dt.timedelta(days=diff)).isoformat()


def read_rows(path):
    ole = OleFile(path)
    workbook = ole.read_stream("Workbook")
    return cells_to_rows(parse_biff(workbook), 0)


def parse_history_file(path, state):
    role_by_name = {role["name"].lower(): role for role in state.get("roles", [])}
    employees = state.get("employees", [])
    shifts = []
    current_date = ""
    for row in read_rows(path):
        first = clean(row[0] if len(row) > 0 else "")
        second = clean(row[1] if len(row) > 1 else "")
        third = clean(row[2] if len(row) > 2 else "")
        date_key = parse_date_heading(first)
        if date_key:
            current_date = date_key
            continue
        if not current_date or first.lower() == "employee name" or not first or not second or not third:
            continue
        role_name = FOH_ROLE_ALIASES.get(second.upper())
        if not role_name:
            continue
        role = role_by_name.get(role_name.lower())
        if not role:
            continue
        start, end = parse_shift_time(third)
        if not start:
            continue
        employee = match_employee(employees, first)
        shifts.append({
            "id": uid("historyShift"),
            "date": current_date,
            "employeeName": first,
            "employeeId": employee.get("id", "") if employee else "",
            "department": role.get("department", "FOH"),
            "roleId": role["id"],
            "start": start,
            "end": end or "Until Volume",
            "untilVolume": not bool(end),
            "color": role.get("color", "#2563eb"),
        })
    week_start = start_of_week(shifts[0]["date"], state.get("settings", {}).get("weekStart", 2)) if shifts else ""
    return {
        "id": uid("history"),
        "sourceName": Path(path).name,
        "importedAt": dt.datetime.utcnow().isoformat() + "Z",
        "weekStart": week_start,
        "shifts": shifts,
    }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: import_ctuit_history.py data.json schedule.xls ...")
    data_path = Path(sys.argv[1])
    envelope = json.loads(data_path.read_text(encoding="utf-8-sig"))
    state = envelope.get("data", envelope)
    backup = data_path.with_name(f"{data_path.stem}.before-ctuit-history-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}{data_path.suffix}")
    shutil.copy2(data_path, backup)
    state.setdefault("scheduleHistory", [])
    imported = []
    for path in sys.argv[2:]:
        record = parse_history_file(path, state)
        if not record["shifts"]:
            imported.append((Path(path).name, 0))
            continue
        existing = next((i for i, week in enumerate(state["scheduleHistory"]) if week.get("sourceName") == record["sourceName"]), -1)
        if existing >= 0:
            record["id"] = state["scheduleHistory"][existing].get("id", record["id"])
            state["scheduleHistory"][existing] = record
        else:
            state["scheduleHistory"].append(record)
        imported.append((Path(path).name, len(record["shifts"])))
    now = dt.datetime.utcnow().isoformat() + "Z"
    envelope["savedAt"] = now
    if "meta" in state:
        state["meta"]["updatedAt"] = now
    data_path.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
    print(f"backup={backup}")
    for name, count in imported:
        print(f"{name}: {count}")


if __name__ == "__main__":
    main()
