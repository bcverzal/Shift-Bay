# Access Matrix Smoke Test

`tools/test_access_matrix.js` checks the permission contract in source code on every normal test run. It also runs live HTTP checks when sandbox credentials are supplied through environment variables.

The live checks are read-only except for one deliberately rejected viewer write. Use sandbox accounts and the sandbox location only.

PowerShell setup:

```powershell
$env:SHIFT_BAY_ACCESS_TEST_BASE_URL = "http://localhost:8798"
$env:SHIFT_BAY_ACCESS_TEST_LOCATION_ID = "<sandbox-location-id>"
$env:SHIFT_BAY_ACCESS_TEST_OTHER_LOCATION_ID = "<another-location-id>"
$env:SHIFT_BAY_ACCESS_TEST_OWNER_TOKEN = "<owner-session-access-token>"
$env:SHIFT_BAY_ACCESS_TEST_MANAGER_TOKEN = "<manager-session-access-token>"
$env:SHIFT_BAY_ACCESS_TEST_VIEWER_TOKEN = "<viewer-session-access-token>"
$env:SHIFT_BAY_ACCESS_TEST_STAFF_TOKEN = "<staff-session-access-token>"
.\runtime\node\node.exe tools\test_access_matrix.js
```

Expected behavior:

| Account | Manager state | Schedule writes | Manager access | Staff routes |
| --- | --- | --- | --- | --- |
| Owner | Read | Allowed | Allowed | Not applicable |
| Manager | Read | Allowed | Rejected | Not applicable |
| Viewer | Read | Rejected | Rejected | Not applicable |
| Staff | Rejected | Rejected | Rejected | Own staff routes only |

The test also verifies that an authenticated user cannot select a location where they have no `location_users` membership. A future browser smoke layer should use the same accounts to inspect visible controls, because source/API checks cannot catch layout or client-only state bugs.
