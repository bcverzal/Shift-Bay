# Event Labor Import

The scheduler can import labor needs from the event/banquet app as CSV.

## Required Columns

```text
Date, Role, Meal, Required Count, Source, Notes
```

Example:

```text
Date,Role,Meal,Required Count,Source,Notes
2026-06-12,Server,Dinner,4,Smith Banquet,80 guests
2026-06-12,Bartender,Dinner,1,Smith Banquet,Open bar
```

## Behavior

- Imported rows add to the day coverage requirement for that date, meal, and role.
- Role names must match scheduler role names, such as `Server` or `Bartender`.
- Meal names should match scheduler meal names, such as `Breakfast`, `Lunch`, `Dinner`, or `Brunch`.
- Imported event counts layer on top of default coverage for that day.

## Event App Export

The event app now has a starter `Export Labor CSV` button in the banquet detail view. Current assumptions:

- Server count is calculated as one server per 25 guests.
- Bartender count is one when bar service/package appears to require bar labor.
- Meal period is inferred from serving/start time.

Future TODO:

- Add configurable server-per-guest rules.
- Add configurable bartender rules based on bar sales projections.
- Add direct export from weekly group events if those should affect staffing too.
