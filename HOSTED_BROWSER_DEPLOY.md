# Shift Bay Hosted Browser Deploy

This is the path for running Shift Bay from a normal web address instead of copying the app to each computer.

## What Runs Where

- Supabase stores the shared scheduler data and handles manager login.
- The Supabase Edge Function `shift-bay-api` acts like the local `server.js` API without exposing the service-role key to the browser.
- A static host such as Vercel, Netlify, or Cloudflare Pages serves the Shift Bay files.

The local laptop and office PC setup can keep working while this hosted version is prepared.

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

## Build A Static Zip

From this folder:

```powershell
.\tools\create_hosted_static_bundle.ps1
```

The script writes a zip under `tmp/hosted-static/`. Upload the extracted contents to the static host.

## Current Limitation

Request-off PDF imports still require the local Shift Bay server. The hosted API currently returns a clear message for that route instead of silently failing.
