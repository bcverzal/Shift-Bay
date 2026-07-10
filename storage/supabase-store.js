const { dataUpdatedAt } = require("./local-json-store");

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

  async function loadDocumentRow(select = "*") {
    const rows = await supabaseFetch(
      config,
      `/scheduler_state_documents?location_id=eq.${encodeURIComponent(config.locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=${select}`
    );
    return Array.isArray(rows) ? rows[0] : null;
  }

  async function logAuditEvent(eventType, user, details = {}) {
    if (!user?.id) return;
    await supabaseFetch(config, "/audit_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        location_id: config.locationId,
        user_id: user.id,
        event_type: eventType,
        entity_type: "scheduler_state_document",
        details
      }])
    }).catch((error) => {
      console.warn("Audit event was not saved:", error?.message || error);
    });
  }

  return {
    mode: "supabase",

    async status() {
      const row = await loadDocumentRow("saved_at,updated_at");
      return {
        ok: true,
        mode: "supabase",
        locationId: config.locationId,
        documentKey,
        updatedAt: row?.updated_at || row?.saved_at || null
      };
    },

    async loadState() {
      const row = await loadDocumentRow("*");
      if (!row) return { exists: false };
      return {
        exists: true,
        payload: {
          app: "restaurant-scheduler",
          schemaVersion: row.schema_version,
          savedAt: row.saved_at,
          savedBy: row.saved_by || null,
          savedByDeviceId: row.saved_by_device_id,
          data: row.state
        }
      };
    },

    async saveState(payload, user = null) {
      const state = payload?.data || payload?.state || payload;
      const savedBy = user?.id || payload?.savedBy?.id || null;
      const savedByDeviceId = payload?.savedByDeviceId || state?.meta?.deviceId || null;
      const baseServerSavedAt = payload?.baseServerSavedAt || state?.meta?.serverSavedAt || "";
      const incomingTime = dataUpdatedAt(payload);
      const existingRow = await loadDocumentRow("state,saved_at,updated_at");
      const existingSavedAt = existingRow?.saved_at || existingRow?.updated_at || "";
      if (baseServerSavedAt && existingSavedAt && Date.parse(existingSavedAt) > Date.parse(baseServerSavedAt) + 1000) {
        return {
          ok: false,
          stale: true,
          incomingUpdatedAt: baseServerSavedAt,
          existingUpdatedAt: existingSavedAt
        };
      }
      const existingTime = dataUpdatedAt(existingRow?.state || { savedAt: existingRow?.saved_at || existingRow?.updated_at });
      if (incomingTime && existingTime && incomingTime < existingTime - 1000) {
        return {
          ok: false,
          stale: true,
          incomingUpdatedAt: new Date(incomingTime).toISOString(),
          existingUpdatedAt: new Date(existingTime).toISOString()
        };
      }
      const body = [{
        location_id: config.locationId,
        document_key: documentKey,
        schema_version: Number(payload?.schemaVersion || state?.meta?.schemaVersion || 1),
        state,
        saved_by: savedBy,
        saved_by_device_id: savedByDeviceId,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }];
      await supabaseFetch(config, "/scheduler_state_documents?on_conflict=location_id,document_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(body)
      });
      await logAuditEvent("scheduler_state_saved", user, {
        documentKey,
        savedAt: body[0].saved_at,
        savedBy,
        savedByEmail: user?.email || payload?.savedBy?.email || "",
        savedByRole: user?.role || payload?.savedBy?.role || "",
        savedByDeviceId,
        schemaVersion: body[0].schema_version
      });
      return { ok: true, savedAt: body[0].saved_at, savedBy };
    },

    async recentAuditEvents(limit = 50) {
      return supabaseFetch(
        config,
        `/audit_events?location_id=eq.${encodeURIComponent(config.locationId)}&select=id,event_type,entity_type,details,created_at,user_id&order=created_at.desc&limit=${Number(limit) || 50}`
      );
    }
  };
}

module.exports = {
  createSupabaseStore
};
