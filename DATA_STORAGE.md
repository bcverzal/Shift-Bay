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

## Storage Modes

The migration branch has a server-side storage adapter. The browser app still uses `/api/state`, while the Node server chooses where that state is stored.

Default local JSON mode:

```text
SHIFT_BAY_STORAGE_MODE=local-json
```

Future Supabase mode:

```text
SHIFT_BAY_STORAGE_MODE=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SHIFT_BAY_LOCATION_ID=...
SHIFT_BAY_DOCUMENT_KEY=primary
```

Use `.env.example` as the template for local environment settings. Never commit a real `.env` file or a Supabase service-role key.

## Storage Roadmap

The current server mode is intentionally simple: one shared JSON file, automatic backups, no database dependency. It is a good bridge between the prototype and a packaged desktop app.

The likely next steps are:

1. Keep local JSON mode stable for restaurant use.
2. Add Supabase state-document mode for laptop/office-PC shared cloud storage.
3. Add manager login and location selection.
4. Migrate copied local data into the Supabase state document.
5. Move from whole-document saves to normalized tables once the cloud connection is proven.

Records should keep stable IDs and timestamps so sync/conflict handling can compare changes by record instead of replacing the whole schedule blindly.
