const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "restaurant-scheduler-data.json");
const outDir = path.join(__dirname, "..", "data");
const wrapper = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const state = wrapper.data || wrapper;

const WEEK_START = "2026-06-23";
const DAY_MS = 86400000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TARGET_DATES = Array.from({ length: 7 }, (_, index) => addDays(WEEK_START, index));
const TARGET_DATE_SET = new Set(TARGET_DATES);
const PAUL_FOH_CAP = 32;

function addDays(dateKey, count) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + count);
  return date.toISOString().slice(0, 10);
}

function parseDate(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function displayDate(dateKey) {
  const date = parseDate(dateKey);
  return `${DAYS[date.getDay()]} ${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeTime(value, fallback = "") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/until\s*volume/i.test(text)) return "Until Volume";
  const compact = text.toLowerCase().replace(/\s+/g, "");
  if (compact === "cl" || compact === "close" || compact === "closing") return "12:00 AM";
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3];
  if (suffix?.startsWith("p") && hour < 12) hour += 12;
  if (suffix?.startsWith("a") && hour === 12) hour = 0;
  if (!suffix && hour > 23) return text;
  const displayHour = hour % 12 || 12;
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function minutes(value) {
  if (!value || /until\s*volume/i.test(value)) return null;
  const normalized = normalizeTime(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function timeFromMinutes(value) {
  const wrapped = ((value % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || bStart == null) return false;
  return aStart < bEnd && bStart < aEnd;
}

function roleById(id) {
  return (state.roles || []).find((role) => role.id === id);
}

function employeeById(id) {
  return (state.employees || []).find((employee) => employee.id === id);
}

function fullName(employee) {
  return [employee?.firstName || "", employee?.lastName || ""].filter(Boolean).join(" ").trim();
}

function displayName(employee) {
  return employee?.nickname || fullName(employee) || "Unknown";
}

function shiftEnd(shift) {
  const start = minutes(shift.start);
  let end = shift.untilVolume ? 22 * 60 : minutes(shift.end);
  if (start != null && end != null && end <= start) end += 1440;
  return end;
}

function shiftHours(shift) {
  const start = minutes(shift.start);
  const end = shiftEnd(shift);
  if (start == null || end == null) return 0;
  return Math.max(0, (end - start) / 60);
}

function shiftTime(shift) {
  return `${shift.start}-${shift.untilVolume ? "Vol" : shift.end}${shift.isFlexDouble ? " Flex" : ""}`;
}

function startOfWeek(dateKey, weekStart) {
  const date = parseDate(dateKey);
  const copy = new Date(date);
  const diff = (copy.getDay() - Number(weekStart ?? 0) + 7) % 7;
  copy.setDate(copy.getDate() - diff);
  return copy.toISOString().slice(0, 10);
}

function availabilityFor(employee, dateKey) {
  const dayIndex = parseDate(dateKey).getDay();
  const weekKey = startOfWeek(dateKey, state.settings?.weekStart ?? 0);
  if (employee?.weeklyAvailability && Object.prototype.hasOwnProperty.call(employee.weeklyAvailability, weekKey)) {
    return employee.weeklyAvailability[weekKey]?.[dayIndex] || [];
  }
  if (employee?.callWeekly) return [{ start: "12:00 AM", end: "11:59 PM" }];
  return employee?.availability?.[dayIndex] || [];
}

function rangeInsideAvailability(employee, shift) {
  const ranges = availabilityFor(employee, shift.date);
  const start = minutes(shift.start);
  const end = shift.untilVolume ? null : minutes(shift.end);
  if (!ranges.length) return false;
  if (start == null || end == null) return true;
  return ranges.some((range) => {
    const availableStart = minutes(range.start);
    const availableEnd = minutes(range.end);
    return availableStart != null && availableEnd != null && start >= availableStart && end <= availableEnd;
  });
}

function availabilityLabel(employee, dateKey) {
  const ranges = availabilityFor(employee, dateKey);
  if (!ranges.length) return "No availability entered";
  return ranges.map((range) => `${range.start}-${range.end}`).join(", ");
}

function activeFohEmployees() {
  return (state.employees || []).filter((employee) => (
    employee.active !== false &&
    !employee.archived &&
    (employee.departments || []).includes("FOH")
  ));
}

function requestOffsFor(employeeId, dateKey) {
  return (state.timeOffRequests || []).filter((request) => request.employeeId === employeeId && request.date === dateKey);
}

function employeeShifts(employeeId, dateKey = "") {
  return (state.shifts || []).filter((shift) => (
    shift.employeeId === employeeId &&
    (!dateKey || shift.date === dateKey) &&
    shift.department === "FOH"
  ));
}

function overlapsExisting(employeeId, proposed) {
  const start = minutes(proposed.start);
  const end = shiftEnd(proposed);
  return employeeShifts(employeeId, proposed.date).filter((shift) => {
    const otherStart = minutes(shift.start);
    const otherEnd = shiftEnd(shift);
    return rangesOverlap(start, end, otherStart, otherEnd);
  });
}

function weekHours(employeeId) {
  return employeeShifts(employeeId)
    .filter((shift) => TARGET_DATE_SET.has(shift.date))
    .reduce((sum, shift) => sum + shiftHours(shift), 0);
}

function candidateWarnings(employee, shift) {
  const role = roleById(shift.roleId);
  const warnings = [];
  if (!(employee.roleTraining || []).includes(shift.roleId)) warnings.push(`not trained as ${role?.name || "role"}`);
  const ro = requestOffsFor(employee.id, shift.date);
  if (ro.length) warnings.push(`RO: ${ro.map((request) => request.daypart || request.note || "request off").join(", ")}`);
  if (!rangeInsideAvailability(employee, shift)) warnings.push(`availability ${availabilityLabel(employee, shift.date)}`);
  const overlaps = overlapsExisting(employee.id, shift);
  if (overlaps.length) warnings.push(`overlap ${overlaps.map((item) => `${roleById(item.roleId)?.name || "Shift"} ${shiftTime(item)}`).join("; ")}`);
  const sameDay = employeeShifts(employee.id, shift.date);
  if (sameDay.length && !overlaps.length) warnings.push(`would be double (${sameDay.map((item) => `${roleById(item.roleId)?.name || "Shift"} ${shiftTime(item)}`).join("; ")})`);
  return warnings;
}

function candidatesForShift(shift) {
  const clean = [];
  const warning = [];
  const blocked = [];
  activeFohEmployees().forEach((employee) => {
    const role = roleById(shift.roleId);
    const trained = (employee.roleTraining || []).includes(shift.roleId);
    const warnings = candidateWarnings(employee, shift);
    const overlaps = warnings.some((item) => item.startsWith("overlap"));
    const entry = {
      name: displayName(employee),
      fullName: fullName(employee),
      phone: employee.phone || "",
      availability: availabilityLabel(employee, shift.date),
      weekHours: weekHours(employee.id),
      notes: employee.managerNotes || "",
      warnings
    };
    if (!trained || overlaps || requestOffsFor(employee.id, shift.date).length) blocked.push(entry);
    else if (warnings.length) warning.push(entry);
    else clean.push(entry);
  });
  const sorter = (a, b) => a.weekHours - b.weekHours || a.name.localeCompare(b.name);
  return {
    clean: clean.sort(sorter).slice(0, 12),
    warning: warning.sort(sorter).slice(0, 12),
    blocked: blocked.sort(sorter).slice(0, 8)
  };
}

function buildAuditIssues() {
  const issues = [];
  const bay = (state.unassignedShifts || []).filter((shift) => TARGET_DATE_SET.has(shift.date));
  bay.forEach((shift) => {
    issues.push({
      severity: "HIGH",
      type: "Open bay shift",
      date: shift.date,
      text: `Unassigned ${roleById(shift.roleId)?.name || "Role"} ${shiftTime(shift)}`
    });
  });
  (state.shifts || [])
    .filter((shift) => TARGET_DATE_SET.has(shift.date))
    .forEach((shift) => {
      const employee = employeeById(shift.employeeId);
      const name = `${displayName(employee)} ${fullName(employee)}`;
      if (/Patty/i.test(name) && shift.date === "2026-06-28" && minutes(shift.start) < 12 * 60) {
        issues.push({
          severity: "HIGH",
          type: "Manager note",
          date: shift.date,
          text: "Patty is scheduled Sunday morning. Note says never Patty for Sunday brunch/opening."
        });
      }
      if (/Henry Scherf/i.test(name) && shift.date === "2026-06-27" && minutes(shift.start) >= 15 * 60) {
        issues.push({
          severity: "MED",
          type: "Manager note",
          date: shift.date,
          text: "Henry is scheduled Saturday night. If he works buffet that week, note says he should be off Saturday night."
        });
      }
    });
  const paul = (state.employees || []).find((employee) => /Paul Schellin/i.test(fullName(employee)));
  const paulHours = paul ? weekHours(paul.id) : 0;
  if (paul && paulHours > PAUL_FOH_CAP) {
    issues.push({
      severity: "HIGH",
      type: "Paul FOH hour cap",
      date: "2026-06-29",
      text: `Paul is scheduled ${paulHours.toFixed(1)} FOH hours. Cap target is ${PAUL_FOH_CAP}.`,
      paulHours
    });
  }
  addDoubleIssues(issues);
  addClopenIssues(issues);
  addPreferenceIssues(issues);
  return issues.sort((a, b) => {
    const rank = { HIGH: 0, MED: 1, LOW: 2 };
    return rank[a.severity] - rank[b.severity] || a.date.localeCompare(b.date) || a.type.localeCompare(b.type);
  });
}

function isAcceptedDouble(sameDayShifts) {
  const employee = employeeById(sameDayShifts[0]?.employeeId);
  const name = `${displayName(employee)} ${fullName(employee)}`;
  const date = sameDayShifts[0]?.date || "";
  if (/Penny Abel/i.test(name)) return true;
  if (/Paul Schellin/i.test(name) && ["2026-06-26", "2026-06-27"].includes(date)) {
    const roles = sameDayShifts.map((shift) => roleById(shift.roleId)?.name || "");
    return roles.every((role) => role === "Host" || role === "Expo");
  }
  if (sameDayShifts.some((shift) => shift.isFlexDouble)) return true;
  return false;
}

function addDoubleIssues(issues) {
  const groups = new Map();
  (state.shifts || [])
    .filter((shift) => TARGET_DATE_SET.has(shift.date) && shift.department === "FOH")
    .forEach((shift) => {
      const key = `${shift.employeeId}|${shift.date}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(shift);
    });
  groups.forEach((sameDayShifts) => {
    if (sameDayShifts.length <= 1) return;
    sameDayShifts.sort((a, b) => (minutes(a.start) || 0) - (minutes(b.start) || 0));
    if (isAcceptedDouble(sameDayShifts)) return;
    const overlapNotes = [];
    for (let i = 0; i < sameDayShifts.length; i += 1) {
      for (let j = i + 1; j < sameDayShifts.length; j += 1) {
        const a = sameDayShifts[i];
        const b = sameDayShifts[j];
        if (rangesOverlap(minutes(a.start), shiftEnd(a), minutes(b.start), shiftEnd(b))) {
          overlapNotes.push(`${roleById(a.roleId)?.name || "Shift"} ${shiftTime(a)} overlaps ${roleById(b.roleId)?.name || "Shift"} ${shiftTime(b)}`);
        }
      }
    }
    const employee = employeeById(sameDayShifts[0].employeeId);
    issues.push({
      severity: overlapNotes.length ? "HIGH" : "MED",
      type: overlapNotes.length ? "Overlapping double" : "Double",
      date: sameDayShifts[0].date,
      text: `${displayName(employee)}: ${sameDayShifts.map((shift) => `${roleById(shift.roleId)?.name || "Shift"} ${shiftTime(shift)}`).join(", ")}${overlapNotes.length ? ` (${overlapNotes.join("; ")})` : ""}`
    });
  });
}

function addClopenIssues(issues) {
  const groups = new Map();
  (state.shifts || [])
    .filter((shift) => TARGET_DATE_SET.has(shift.date) && shift.department === "FOH")
    .forEach((shift) => {
      if (!groups.has(shift.employeeId)) groups.set(shift.employeeId, []);
      groups.get(shift.employeeId).push(shift);
    });
  groups.forEach((employeeShifts, employeeId) => {
    employeeShifts.sort((a, b) => a.date.localeCompare(b.date) || (minutes(a.start) || 0) - (minutes(b.start) || 0));
    for (let index = 0; index < employeeShifts.length - 1; index += 1) {
      const current = employeeShifts[index];
      const next = employeeShifts[index + 1];
      if (addDays(current.date, 1) !== next.date) continue;
      const currentEnd = shiftEnd(current);
      const nextStart = minutes(next.start);
      if (currentEnd == null || nextStart == null) continue;
      const rest = (1440 - currentEnd + nextStart) / 60;
      if ((current.isCloser || currentEnd >= 21 * 60 + 30) && nextStart <= 10 * 60 && rest < 10) {
        issues.push({
          severity: "MED",
          type: "Clopen",
          date: next.date,
          text: `${displayName(employeeById(employeeId))}: closes ${displayDate(current.date)} ${shiftTime(current)}, opens ${displayDate(next.date)} ${shiftTime(next)} (${rest.toFixed(1)}h rest)`
        });
      }
    }
  });
}

function addPreferenceIssues(issues) {
  (state.shifts || [])
    .filter((shift) => TARGET_DATE_SET.has(shift.date) && shift.department === "FOH")
    .forEach((shift) => {
      const employee = employeeById(shift.employeeId);
      const name = `${displayName(employee)} ${fullName(employee)}`;
      if (/Penny Abel/i.test(name) && shift.date === "2026-06-28") {
        issues.push({
          severity: "LOW",
          type: "Preference",
          date: shift.date,
          text: `Penny is scheduled Sunday ${roleById(shift.roleId)?.name || "Shift"} ${shiftTime(shift)}. If she is asked to help Saturday too, confirm she is still willing to work Sunday.`
        });
      }
    });
}

function buildPaulReductionOptions() {
  const paul = (state.employees || []).find((employee) => /Paul Schellin/i.test(fullName(employee)));
  if (!paul) return [];
  return employeeShifts(paul.id)
    .filter((shift) => TARGET_DATE_SET.has(shift.date))
    .map((shift) => ({
      date: shift.date,
      label: `${displayDate(shift.date)} ${roleById(shift.roleId)?.name || "Role"} ${shiftTime(shift)}`,
      hours: shiftHours(shift),
      note: shift.date === "2026-06-26" || shift.date === "2026-06-27"
        ? "Paul Friday/Saturday Host/Expo can be intentional, but cap still matters."
        : ""
    }))
    .sort((a, b) => b.hours - a.hours || a.date.localeCompare(b.date));
}

function scheduleCounts() {
  return TARGET_DATES.map((dateKey) => ({
    date: dateKey,
    label: displayDate(dateKey),
    assigned: (state.shifts || []).filter((shift) => shift.date === dateKey && shift.department === "FOH").length,
    bay: (state.unassignedShifts || []).filter((shift) => shift.date === dateKey && shift.department === "FOH").length,
    requestsOff: (state.timeOffRequests || []).filter((request) => request.date === dateKey).length
  }));
}

function compactPrintChecklist() {
  return [
    "Open Shift Bay in Chrome at http://localhost:8787 and confirm active week is Tue 6/23 - Mon 6/29.",
    "Use the compact print view after the 5 open bay shifts and Patty/Paul blockers are handled.",
    "Compact schedule should include RO/unavailable markers, start-end times with dashes, and role group sections.",
    "Print completed week should include 1 compact schedule plus all floor plans.",
    "Floor plans expected for this schedule week: Tue All-Day, Wed All-Day, Thu All-Day, Fri AM, Fri PM, Sat AM, Sat PM, Sun AM, Sun PM, Mon All-Day.",
    "Before posting, have the reviewer check: Sunday brunch host/server assignments, Paul FOH hours, Saturday/Sunday bussers, and all marked doubles/flex doubles."
  ];
}

function markdownList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function buildPacket() {
  const bay = (state.unassignedShifts || [])
    .filter((shift) => TARGET_DATE_SET.has(shift.date) && shift.department === "FOH")
    .sort((a, b) => a.date.localeCompare(b.date) || (minutes(a.start) ?? 0) - (minutes(b.start) ?? 0));
  const openShiftDetails = bay.map((shift) => ({
    id: shift.id,
    date: shift.date,
    label: `${displayDate(shift.date)} ${roleById(shift.roleId)?.name || "Role"} ${shiftTime(shift)}`,
    role: roleById(shift.roleId)?.name || "Role",
    candidates: candidatesForShift(shift)
  }));
  return {
    generatedAt: new Date().toISOString(),
    week: "June 23-29, 2026",
    counts: scheduleCounts(),
    issues: buildAuditIssues(),
    openShiftDetails,
    paulReductionOptions: buildPaulReductionOptions(),
    printChecklist: compactPrintChecklist()
  };
}

function toMarkdown(packet) {
  const lines = [];
  lines.push("# June 23-29 Schedule Review Packet");
  lines.push("");
  lines.push(`Generated: ${packet.generatedAt}`);
  lines.push("");
  lines.push("## Snapshot");
  lines.push("");
  packet.counts.forEach((count) => {
    lines.push(`- ${count.label}: ${count.assigned} assigned, ${count.bay} in Shift Bay, ${count.requestsOff} ROs`);
  });
  lines.push("");
  lines.push("## Must Fix First");
  lines.push("");
  const highIssues = packet.issues.filter((issue) => issue.severity === "HIGH");
  lines.push(markdownList(highIssues.map((issue) => `${displayDate(issue.date)} - ${issue.type}: ${issue.text}`)));
  lines.push("");
  lines.push("## Open Shift Bay Candidate Pools");
  lines.push("");
  packet.openShiftDetails.forEach((detail) => {
    lines.push(`### ${detail.label}`);
    lines.push("");
    lines.push("Clean candidates:");
    lines.push(markdownList(detail.candidates.clean.map((candidate) => `${candidate.name} (${candidate.weekHours.toFixed(1)} hrs, avail ${candidate.availability})${candidate.phone ? ` - ${candidate.phone}` : ""}`)));
    lines.push("");
    lines.push("Possible with warning:");
    lines.push(markdownList(detail.candidates.warning.map((candidate) => `${candidate.name} (${candidate.weekHours.toFixed(1)} hrs) - ${candidate.warnings.join("; ")}`)));
    lines.push("");
  });
  lines.push("## Paul Hour Reduction Menu");
  lines.push("");
  lines.push(`Target: ${PAUL_FOH_CAP} FOH hours. Remove or shorten enough FOH time to get under the cap.`);
  lines.push("");
  lines.push(markdownList(packet.paulReductionOptions.map((option) => `${option.label} = ${option.hours.toFixed(1)} hrs${option.note ? ` (${option.note})` : ""}`)));
  lines.push("");
  lines.push("## Judgment Calls To Review");
  lines.push("");
  const mediumIssues = packet.issues.filter((issue) => issue.severity !== "HIGH");
  lines.push(markdownList(mediumIssues.map((issue) => `${displayDate(issue.date)} - ${issue.type}: ${issue.text}`)));
  lines.push("");
  lines.push("## Print Checklist");
  lines.push("");
  lines.push(markdownList(packet.printChecklist));
  lines.push("");
  lines.push("## Fast Morning Order");
  lines.push("");
  lines.push(markdownList([
    "Fix the 5 open Shift Bay shifts or deliberately delete any extras.",
    "Replace/remove Patty from Sunday morning.",
    "Reduce Paul from 42 FOH hours toward the 32-hour cap.",
    "Mark intentional long Friday/Saturday/Sunday shifts as Flex Double where appropriate.",
    "Run audit again.",
    "Open compact preview and check for text overlap.",
    "Print completed week: compact schedule plus floor plans."
  ]));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const packet = buildPacket();
const jsonPath = path.join(outDir, "june-23-review-packet.json");
const mdPath = path.join(outDir, "june-23-review-packet.md");
const htmlPath = path.join(outDir, "june-23-review-packet.html");
fs.writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`);
const markdown = toMarkdown(packet);
fs.writeFileSync(mdPath, markdown);
fs.writeFileSync(htmlPath, toHtml(markdown));

console.log(JSON.stringify({
  markdown: mdPath,
  html: htmlPath,
  json: jsonPath,
  highIssues: packet.issues.filter((issue) => issue.severity === "HIGH").length,
  openShifts: packet.openShiftDetails.length
}, null, 2));

function toHtml(markdown) {
  const escape = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = markdown.split(/\r?\n/).map((line) => {
    if (line.startsWith("# ")) return `<h1>${escape(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escape(line.slice(3))}</h2>`;
    if (line.startsWith("### ")) return `<h3>${escape(line.slice(4))}</h3>`;
    if (line.startsWith("- ")) return `<li>${escape(line.slice(2))}</li>`;
    if (!line.trim()) return "";
    return `<p>${escape(line)}</p>`;
  }).join("\n").replace(/(<li>.*?<\/li>\n?)+/gs, (match) => `<ul>\n${match}</ul>\n`);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>June 23-29 Schedule Review Packet</title>
  <style>
    body { margin: 28px auto; max-width: 980px; padding: 0 20px; color: #111827; font-family: Arial, sans-serif; line-height: 1.45; background: #f6f8fb; }
    h1 { margin: 0 0 14px; color: #0f172a; }
    h2 { margin-top: 28px; padding-top: 14px; border-top: 2px solid #d9e2ef; color: #12315f; }
    h3 { margin: 20px 0 8px; color: #334155; }
    ul { margin: 8px 0 16px; padding: 12px 18px 12px 28px; border: 1px solid #d9e2ef; border-radius: 8px; background: #fff; }
    li { margin: 5px 0; }
    p { color: #475569; }
    @media print { body { background: #fff; max-width: none; } ul { break-inside: avoid; } }
  </style>
</head>
<body>
${body}
</body>
</html>
`;
}
