# Shift Bay Hosted Browser Deploy

This is the path for running Shift Bay from a normal web address instead of copying the app to each computer.

## What Runs Where

- Supabase stores the shared scheduler data and handles manager login.
- The Supabase Edge Function `shift-bay-api` acts like the local `server.js` API without exposing the service-role key to the browser.
- A static host such as Vercel, Netlify, or Cloudflare Pages serves the Shift Bay files.

The local laptop and office PC setup can keep working while this hosted version is prepared.

Production hosted URL:

```text
https://shift-bay.netlify.app
```

## Supabase Edge Function

Deploy the function in:

```text
supabase/functions/shift-bay-api
```

Function name:

```text
shift-bay-api
```

Required function secrets:

```text
SUPABASE_URL=https://aynvsocycljrhmjtyjib.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SHIFT_BAY_LOCATION_ID=f477e013-0dee-470b-b2c6-595cef195b31
SHIFT_BAY_DOCUMENT_KEY=primary
```

Never place the service-role key in any browser file.

## Deploy Order

1. Deploy the Supabase Edge Function.
2. Add the required Edge Function secrets.
3. Open the Edge Function status URL:

```text
https://aynvsocycljrhmjtyjib.supabase.co/functions/v1/shift-bay-api/status
```

Expected result:

```json
{
  "ok": true,
  "mode": "supabase"
}
```

4. Push approved changes to GitHub branch `supabase-migration`.
5. Let Netlify deploy the branch automatically.
6. Open `https://shift-bay.netlify.app` and sign in.
7. Confirm the status badge says `Cloud saved`, not `LOCAL MODE`.

If login works but data does not load, check the Edge Function secrets first.

## Hosted Browser Config

The hosted static site needs a public `shift-bay-config.js` file:

```js
window.SHIFT_BAY_CONFIG = {
  apiBase: "https://aynvsocycljrhmjtyjib.supabase.co/functions/v1/shift-bay-api",
  supabaseUrl: "https://aynvsocycljrhmjtyjib.supabase.co",
  locationId: "f477e013-0dee-470b-b2c6-595cef195b31"
};
```

This file is safe to publish because it only contains public browser configuration.

## Netlify Auto Deploy

Netlify is connected to GitHub branch:

```text
supabase-migration
```

Netlify settings:

```text
Base directory: blank
Build command: blank, or echo "static"
Publish directory: .
Functions directory: blank
```

The `netlify.toml` file keeps the static deploy simple and disables caching for the main app files.

Only push when the change is ready to deploy. Netlify free credits are spent by production deploys, so batch small fixes together when possible.

## Manual Static Zip Fallback

From this folder:

```powershell
.\tools\create_hosted_static_bundle.ps1
```

The script writes a zip under `tmp/hosted-static/`. Upload the extracted contents to the static host only if the GitHub-Netlify deploy path is unavailable.

The generated static zip excludes:

- real `.env` secrets
- local scheduler JSON data
- temp folders
- Git files
- portable Node runtime
- local server logs

## What Changes After Hosting

- We no longer need to copy the app to the office PC for ordinary updates.
- The office PC can use the hosted web address directly if the firewall allows it.
- The local laptop/office-PC version can remain as a fallback while the hosted version is tested.
- Manager invites and change history should be the next cloud features before wider rollout.

## Current Limitation

Request-off PDF imports still require the local Shift Bay server. The hosted API currently returns a clear message for that route instead of silently failing.

## Smoke Test Checklist

Use this before considering the hosted version ready for the restaurant:

- Sign in from two browser windows.
- Create a harmless test shift in one window.
- Refresh the other window and confirm the shift appears.
- Delete the test shift and confirm the deletion syncs.
- Confirm the browser does not show `LOCAL MODE`.
- Confirm compact schedule print opens.
- Confirm floor plan print opens.
- Confirm request-off PDF import shows the local-server-only message instead of silently failing.
