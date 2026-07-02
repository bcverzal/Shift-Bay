import datetime as dt
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def clean(value):
    return str(value or "").strip()


def uid(prefix):
    return f"{prefix}_{int(dt.datetime.now().timestamp() * 1000):x}_{prefix[-3:]}"


def js_day(date_key):
    return (dt.date.fromisoformat(date_key).weekday() + 1) % 7


def minutes(value):
    text = clean(value)
    if not text or "volume" in text.lower():
        return None
    parts = text.upper().replace(" ", "").replace(".", "").split(":")
    if len(parts) < 2:
        return None
    hour = int(parts[0])
    minute = int(parts[1][:2])
    suffix = parts[1][2:]
    if suffix.startswith("P") and hour < 12:
        hour += 12
    if suffix.startswith("A") and hour == 12:
        hour = 0
    return hour * 60 + minute


def overlaps(a_start, a_end, b_start, b_end):
    if a_start is None:
        return False
    if a_end is None:
        a_end = 24 * 60
    return a_start < b_end and b_start < a_end


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: build_history_patterns.py data.json")
    path = Path(sys.argv[1])
    envelope = json.loads(path.read_text(encoding="utf-8-sig"))
    state = envelope.get("data", envelope)
    roles = {role["id"]: role for role in state.get("roles", [])}
    history = state.get("scheduleHistory", [])
    week_count = max(1, len(history))
    threshold = 1 if week_count <= 2 else max(2, (week_count + 1) // 2)

    pattern_weeks = defaultdict(set)
    pattern_shift = {}
    coverage = defaultdict(list)

    for week in history:
        week_id = week.get("id")
        week_coverage_counts = defaultdict(int)
        for shift in week.get("shifts", []):
            role = roles.get(shift.get("roleId"))
            if not role:
                continue
            day = js_day(shift["date"])
            end = "Until Volume" if shift.get("untilVolume") else shift.get("end")
            signature = (day, shift.get("department") or role.get("department") or "FOH", shift["roleId"], shift.get("start"), end, bool(shift.get("untilVolume")), bool(shift.get("isCloser")))
            pattern_weeks[signature].add(week_id)
            pattern_shift[signature] = {
                "dayIndex": day,
                "department": signature[1],
                "roleId": shift["roleId"],
                "start": shift.get("start"),
                "end": end,
                "untilVolume": bool(shift.get("untilVolume")),
                "isCloser": bool(shift.get("isCloser")),
                "color": shift.get("color") or role.get("color") or "#2563eb",
            }
            start_min = minutes(shift.get("start"))
            end_min = minutes(shift.get("end"))
            for period in (state.get("settings", {}).get("mealPeriods", {}).get(str(day)) or []):
                p_start = minutes(period.get("start"))
                p_end = minutes(period.get("end"))
                if p_start is None or p_end is None:
                    continue
                if overlaps(start_min, end_min, p_start, p_end):
                    week_coverage_counts[(day, period.get("name"), shift["roleId"])] += 1
        for key, count in week_coverage_counts.items():
            coverage[key].append(count)

    template_shifts = []
    for signature, weeks in pattern_weeks.items():
        if len(weeks) < threshold:
            continue
        item = dict(pattern_shift[signature])
        item["id"] = uid("templateShift")
        template_shifts.append(item)
    template_shifts.sort(key=lambda item: (int(item["dayIndex"]), minutes(item.get("start")) or 0, roles.get(item.get("roleId"), {}).get("name", "")))

    if template_shifts:
        existing = next((template for template in state.get("templates", []) if template.get("name") == "History Pattern Template"), None)
        if existing:
            existing["shifts"] = template_shifts
        else:
            state.setdefault("templates", []).append({"id": uid("template"), "name": "History Pattern Template", "shifts": template_shifts})

    default_coverage = state.setdefault("settings", {}).setdefault("defaultCoverage", {})
    for (day, meal, role_id), counts in coverage.items():
        suggested = int(statistics.median(counts))
        default_coverage.setdefault(str(day), {}).setdefault(meal, {})[role_id] = suggested

    now = dt.datetime.now(dt.UTC).isoformat().replace("+00:00", "Z")
    envelope["savedAt"] = now
    if "meta" in state:
        state["meta"]["updatedAt"] = now
    path.write_text(json.dumps(envelope, indent=2), encoding="utf-8")
    print(f"weeks={week_count}")
    print(f"threshold={threshold}")
    print(f"template_shifts={len(template_shifts)}")
    print(f"coverage_pars={len(coverage)}")


if __name__ == "__main__":
    main()
