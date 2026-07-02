# Restaurant Scheduler Data Storage

The original prototype storage is browser `localStorage` under `restaurantScheduler.v1`.

The app can now also run through a small local Node server. In server mode the shared schedule data is saved to:

```text
restaurant-scheduler/data/restaurant-scheduler-data.json
```

Each save copies the previous file into:

```text
restaurant-scheduler/data/backups/
```

## Running Shared File Mode

On the computer that should own the data, run:

```text
Start Restaurant Scheduler Server.bat
```

That opens the app at:

```text
http://localhost:8787
```

If the office PC hosts it, the laptop can open the same app using the office PC name or IP address:

```text
http://OFFICE-PC-NAME:8787
```

or:

```text
http://192.168.x.x:8787
```

The server must stay open on the office PC while another computer is using the scheduler.

The app now wraps saved data with sync-ready metadata:

- `meta.schemaVersion`
- `meta.documentId`
- `meta.deviceId`
- `meta.createdAt`
- `meta.updatedAt`
- record-level `createdAt` / `updatedAt` defaults

Backups are exported as a JSON envelope:

```json
{
  "app": "restaurant-scheduler",
  "schemaVersion": 2,
  "exportedAt": "...",
  "exportedByDeviceId": "...",
  "data": {}
}
```

Restore accepts both this envelope format and older raw state backups.

## Storage Roadmap

The current server mode is intentionally simple: one shared JSON file, automatic backups, no database dependency. It is a good bridge between the prototype and a packaged desktop app.

The likely next steps are:

1. Add a visible server/storage status indicator in the app.
2. Add import/export tools for moving the first shared data file onto the office PC.
3. Package the app so the server starts like a normal desktop program.
4. Move from whole-file saves to SQLite or record-level sync when multiple people might edit at once.

Records should keep stable IDs and timestamps so sync/conflict handling can compare changes by record instead of replacing the whole schedule blindly.
