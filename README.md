# Shift Bay

Local, laptop-only restaurant scheduling prototype.

## Open It

Open `index.html` in a browser:

```text
C:\Users\bcver\Desktop\Monthly Group Calendar\restaurant-scheduler\index.html
```

No server or install step is required.

## Current Features

- Weekly schedule builder with employees as rows and days as columns.
- Tuesday is the default week start, changeable in Settings.
- Monthly read-only overview.
- Editable roles under FOH, BOH, and Exec departments.
- Employee profiles with meal training, role training, active status, and multiple availability windows per day.
- Employee role training can mark roles as emergency-only and can override meal training by role.
- Employee availability rows have an Open button to fill an all-day availability range.
- Employee weekly work rules can warn when someone exceeds a max number of work days across selected weekdays, such as Fri/Sat/Sun.
- Trainer eligibility can be set per employee and training shifts can track trainee, trainer, and training day number.
- Shift templates with editable start/end times and an Until Volume option.
- Time fields open a half-hour dropdown starting from the current field value.
- Meal hours are set in Settings and shifts are automatically matched to meals by time.
- Day coverage buttons track required FOH role counts by meal period.
- Print warns when a week has missing required coverage.
- Staffing analysis compares default coverage needs against trained availability and suggests hire gaps.
- Event labor needs can be imported from CSV and added to day coverage.
- Training plan builder can suggest trainee shifts from scheduled trainer shifts after a start date.
- Training settings can include required shift names and weekdays, such as Friday Fish Fry or Sunday Brunch.
- Multiple stacked shifts per employee per day.
- Click a cell and add a template-based shift.
- Double-click a shift to edit it.
- Double-click an empty cell to add a shift.
- Drag shifts to move them.
- Ctrl+drag to duplicate one shift.
- Ctrl+Shift+drag through cells to duplicate the shift across multiple valid cells.
- Ctrl+C, Ctrl+V, Ctrl+Z, Enter, and Delete shortcuts.
- FOH training mismatches are blocked.
- Availability and overlap conflicts warn.
- Developer testing setting can allow warning-level changes without asking each time.
- BOH and Exec training mismatches warn instead of blocking.
- Department visibility checkboxes for build/print views.
- CSV export for schedule transfer/reference.
- Employee CSV import for names and phone numbers.
- JSON backup and restore.

## Planned / To Do

- Rebuild employee priority/suggestion scoring later as a real ranking system using seniority, sales data, shift performance, close/double preferences, and learned scheduling patterns. The earlier simple “priority/favorite” toggle has been removed for now.
- Rebuild the removed Quick Training feature later as a guided workflow that creates or links actual training shifts without automatically marking employees trained for roles or all meal periods.
- Add a day focus mode: double-click a date header in the weekly grid to temporarily show only that day, with a clear way back to the full week view. In focus mode, expand the day column and consider filtering the Shift Bay to that date.
- Remove the `@` symbol from the line after Banquet on the printed floor plan.
- Redesign the Shift Detail window so it is more visually polished, easier to scan, and less cramped.
- Make template editing more intuitive: collapse each saved template by default so the list is easier to scan, add a clear expand button to show its shifts, and make individual template shifts easier to click, delete, and adjust start/end times without extra scrolling or hunting.
- Create an in-app user tutorial that teaches the scheduler workflow and explains the major features, including the Shift Bay, templates, availability, warnings, printing, employee setup, floor plans, imports, backups, and keyboard/mouse shortcuts.
- Once the Shift Bay icon is finalized, use it as a faint step-and-repeat background behind the bay shifts at roughly 25% opacity so the Shift Bay feels like the app's signature workspace.

## Data Storage

The prototype stores data in the browser's local storage for this app. Use Backup regularly to save a JSON copy of the whole scheduler.

## Export Shape

CSV export columns:

```text
Date, Employee, Department, Role, Meals, Start Time, End Time, Until Volume, Notes
```

That format is meant to be easy to reshape later if Ctuit/R365 exposes an import template.

## Employee Import

The app can import employee CSV files with these columns:

```text
First Name, Last Name, Phone
```

It also accepts a single `Name` or `Employee Name` column instead of separate first and last name columns.

Plain TXT phone lists are also supported when each employee is on a line with a phone number, for example:

```text
Jane Smith (555) 123-4567
Doe, John 555-222-3333
```

The browser app does not read PDFs directly. If you choose a PDF, it will show a message asking you to convert it first.

If your employee list is in a text-based PDF, use the helper script to convert it to CSV:

```text
python tools/pdf_employee_import.py "C:\path\to\employees.pdf" "C:\path\to\employees_import.csv"
```

Then open the scheduler and use **Import Employees**. Review the CSV before importing, because PDFs can arrange text in strange ways.

If the script says `pypdf` is missing, install it with:

```text
python -m pip install pypdf
```
