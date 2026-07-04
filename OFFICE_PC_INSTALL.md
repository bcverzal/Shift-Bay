# Shift Bay Office PC Install

This is the short setup path for running Shift Bay on the office PC while sharing schedule data through Supabase.

## What The Office PC Runs

The office PC does not need to connect to Brian's laptop. It runs its own local Shift Bay server and talks to Supabase:

```text
Office PC browser -> http://localhost:8798 -> local Shift Bay server -> Supabase
```

Brian's laptop does the same thing from its own copy:

```text
Laptop browser -> http://localhost:8798 -> local Shift Bay server -> Supabase
```

## Files Needed

Copy the `restaurant-scheduler-supabase` folder to the office PC.

Do not copy `.git`, `tmp`, logs, or old local data unless you are intentionally debugging. The cloud schedule data lives in Supabase.

## Required `.env`

The office PC needs a real `.env` file in the Shift Bay folder. Use `.env.example` as the shape:

```text
SHIFT_BAY_STORAGE_MODE=supabase
PORT=8798
HOST=127.0.0.1
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SHIFT_BAY_LOCATION_ID=...
SHIFT_BAY_DOCUMENT_KEY=primary
```

Never put the service-role key into GitHub, screenshots, or chat. It belongs only in local `.env` files on computers trusted to run the manager app.

## Start It

If the `.bat` says `node is not recognized`, use the newer office install bundle that includes:

```text
runtime\node\node.exe
```

That avoids installing Node.js on the office PC.

Preferred:

```text
Launch Shift Bay Cloud.ps1
```

Fallback if PowerShell script launching is blocked:

```text
Start Shift Bay Cloud Server.bat
```

Then open:

```text
http://localhost:8798/
```

## Expected First Test

1. The login screen appears.
2. Sign in with the manager account.
3. Account menu should show `Cloud location connected`.
4. The storage badge should say `Cloud saved`.
5. The schedule should load the same employees, shifts, templates, and request offs as the laptop.
6. Make a harmless test change, use `Sync now`, refresh the laptop, and confirm the change appears.

If the storage badge says `LOCAL MODE`, stop and fix `.env` before entering schedule changes. Local mode changes stay only on that PC and do not sync.

## Firewall Prompt

If Windows Firewall asks whether to allow Node.js, click **Cancel**. Shift Bay only needs the browser on this same PC to connect to `127.0.0.1`, and it reaches Supabase using outbound HTTPS.

The app should not need inbound network access unless you deliberately set:

```text
HOST=0.0.0.0
```

Do not use that setting on the office PC unless you specifically want other devices to connect directly to that PC.

## Likely Blockers

- **Node.js missing**: use the office bundle with `runtime\node\node.exe`.
- **PowerShell blocked**: use the `.bat` launcher.
- **Chrome unavailable**: open `http://localhost:8798/` manually in the available browser.
- **Supabase blocked by firewall**: the app may load but login or sync will fail. Test with a hotspot or ask IT to allow the Supabase project URL.
- **Address already in use `127.0.0.1:8798`**: another Shift Bay server is already running. Close any black Shift Bay server windows. If it still happens, open Task Manager and end `Node.js JavaScript Runtime`, or restart the PC.

## Daily Use Notes

- Start Shift Bay with `Start Shift Bay Cloud Server.bat`.
- Keep the black server window open while using Shift Bay.
- If Windows Firewall asks to allow Node.js, click **Cancel**.
- Before making schedule changes, confirm the badge says `Cloud saved`, `Cloud saving`, or `Cloud connecting`, not `LOCAL MODE`.
- Use `Sync now` before closing if you made important changes.
