# shift-bay-api

Supabase Edge Function bridge for the hosted browser version of Shift Bay.

It mimics the local Node server routes without exposing the service-role key to the browser.

## Routes

With function URL:

```text
https://PROJECT_REF.supabase.co/functions/v1/shift-bay-api
```

Routes:

```text
GET  /auth/config
POST /auth/login
GET  /auth/session
GET  /status
GET  /state
PUT  /state
POST /state
```

The browser app maps local `/api/...` calls to these routes when `SHIFT_BAY_CONFIG.apiBase` is set.

## Required Secrets

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SHIFT_BAY_LOCATION_ID
SHIFT_BAY_DOCUMENT_KEY=primary
```

Do not put the service-role key in browser config.
