// Public Shift Bay config. This file contains no service-role secrets.
// Localhost uses the local server bridge, which is still cloud-backed through
// its .env file. The hosted site continues to call the deployed Edge Function.
const shiftBayIsLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
window.SHIFT_BAY_CONFIG = {
  apiBase: shiftBayIsLocalHost ? "" : "https://aynvsocycljrhmjtyjib.supabase.co/functions/v1/shift-bay-api",
  supabaseUrl: "https://aynvsocycljrhmjtyjib.supabase.co",
  locationId: "f477e013-0dee-470b-b2c6-595cef195b31",
  enableCloudOnLocal: true
};
