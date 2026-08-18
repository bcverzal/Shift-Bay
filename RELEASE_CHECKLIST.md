# Shift Bay Release Checklist

Use this before pushing changes that will auto-deploy to Netlify.

For the full first-pass migration audit and repeatable review process, see
[`docs/POST_MIGRATION_REVIEW_CHECKLIST.md`](docs/POST_MIGRATION_REVIEW_CHECKLIST.md).

## Before Push

- Confirm the work is in `restaurant-scheduler-supabase` on branch `supabase-migration`.
- Run a syntax check:

```powershell
$node = Get-ChildItem -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
& $node --check app.js
& $node --check server.js
```

- Check no secrets are tracked:

```powershell
git grep -n "sbp_\|SUPABASE_SERVICE_ROLE_KEY=.*ey" -- . ':!.env.example'
```

- Review `git status --short`.
- Batch small visual fixes together when possible to save Netlify credits.

## After Netlify Deploy

Open:

```text
https://shift-bay.netlify.app
```

Check:

- Login works.
- Badge says `Cloud saved`, not `LOCAL MODE`.
- A harmless test change survives refresh.
- Another browser window can see the change after refresh.
- Manager Access opens and closes cleanly.
- Print dialog opens.

## Fallback

If hosted deploy breaks, use the office-PC/local bridge or the local active app until the hosted branch is fixed.
