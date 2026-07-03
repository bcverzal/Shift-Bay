function requireSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const locationId = process.env.SHIFT_BAY_LOCATION_ID;
  if (!url || !serviceRoleKey || !locationId) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!locationId) missing.push("SHIFT_BAY_LOCATION_ID");
    throw new Error(`Supabase storage is not configured. Missing ${missing.join(", ")}.`);
  }
  return { url: url.replace(/\/$/, ""), serviceRoleKey, locationId };
}

async function supabaseFetch(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.hint || body?.details || `Supabase request failed with ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function createSupabaseStore() {
  const config = requireSupabaseConfig();
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";

  return {
    mode: "supabase",

    async status() {
      return {
        ok: true,
        mode: "supabase",
        locationId: config.locationId,
        documentKey,
        updatedAt: null
      };
    },

    async loadState() {
      const rows = await supabaseFetch(
        config,
        `/scheduler_state_documents?location_id=eq.${encodeURIComponent(config.locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=*`
      );
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) return { exists: false };
      return {
        exists: true,
        payload: {
          app: "restaurant-scheduler",
          schemaVersion: row.schema_version,
          savedAt: row.saved_at,
          savedByDeviceId: row.saved_by_device_id,
          data: row.state
        }
      };
    },

    async saveState(payload) {
      const state = payload?.data || payload?.state || payload;
      const savedByDeviceId = payload?.savedByDeviceId || state?.meta?.deviceId || null;
      const body = [{
        location_id: config.locationId,
        document_key: documentKey,
        schema_version: Number(payload?.schemaVersion || state?.meta?.schemaVersion || 1),
        state,
        saved_by_device_id: savedByDeviceId,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }];
      await supabaseFetch(config, "/scheduler_state_documents?on_conflict=location_id,document_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body)
      });
      return { ok: true, savedAt: body[0].saved_at };
    }
  };
}

module.exports = {
  createSupabaseStore
};
