# Supabase Setup Checklist

Use this when Brian is ready to create the Shift Bay Supabase project.

## 1. Create Project

1. Go to Supabase.
2. Create a new project.
3. Use a clear name such as `shift-bay-pewaukee` or `shift-bay-dev`.
4. Choose a strong database password and save it somewhere safe.
5. Select the closest region available.

## 2. Collect Project Values

From the Supabase project settings, collect:

- Project URL
- Anon public key
- Service role key

The service role key is secret. It belongs only in the local server `.env` file, never in browser code and never in Git.

## 3. Run Database Schema

1. Open SQL Editor.
2. Run `supabase/schema.sql`.
3. Confirm the tables exist.

## 4. Create First Location

Run this SQL in Supabase SQL Editor:

```sql
insert into public.locations (name, timezone)
values ('Machine Shed Pewaukee', 'America/Chicago')
returning id;
```

Copy the returned `id`. This becomes:

```text
SHIFT_BAY_LOCATION_ID=that-returned-id
```

## 5. Create Manager User

1. Go to Authentication.
2. Add/invite the first manager user.
3. Copy the user's Supabase auth UUID.
4. Add that user to the location:

```sql
insert into public.location_users (location_id, user_id, role)
values ('LOCATION_ID_HERE', 'USER_ID_HERE', 'owner');
```

## 6. Configure Local Migration Branch

In `restaurant-scheduler-supabase`, create a `.env` file from `.env.example`:

```text
SHIFT_BAY_STORAGE_MODE=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SHIFT_BAY_LOCATION_ID=your-location-id
SHIFT_BAY_DOCUMENT_KEY=primary
```

## 7. First Smoke Test

Start the migration branch server and open:

```text
http://localhost:8787/api/status
```

Expected result:

```json
{
  "ok": true,
  "mode": "supabase"
}
```

## 8. First Data Migration Test

Use copied data first, not live data.

1. Export/backup the current local Shift Bay data.
2. Prepare it with:

```text
node tools/prepare_supabase_state_document.js backup.json prepared-state.json
```

3. Load the app in Supabase mode.
4. Restore/import the copied data.
5. Confirm save/load works across refreshes.

## Do Not Do Yet

- Do not use employee portal features.
- Do not invite non-manager employees.
- Do not migrate live restaurant data until copied-data testing passes.
- Do not paste service-role keys into browser code, chat, screenshots, or GitHub.
