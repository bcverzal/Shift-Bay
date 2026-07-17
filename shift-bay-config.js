// Public Shift Bay config. This file contains no service-role secrets.
// Keep cloud-on-local enabled here intentionally: localhost is the local app
// shell, but it uses the same authenticated Supabase data as the hosted app.
window.SHIFT_BAY_CONFIG = {
  apiBase: "https://aynvsocycljrhmjtyjib.supabase.co/functions/v1/shift-bay-api",
  supabaseUrl: "https://aynvsocycljrhmjtyjib.supabase.co",
  locationId: "f477e013-0dee-470b-b2c6-595cef195b31",
  enableCloudOnLocal: true
};
