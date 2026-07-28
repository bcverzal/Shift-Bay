const { dataUpdatedAt } = require("./local-json-store");

function requireSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const defaultLocationId = process.env.SHIFT_BAY_LOCATION_ID;
  if (!url || !serviceRoleKey || !defaultLocationId) {
    const missing = [];
    if (!url) missing.push("SUPABASE_URL");
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!defaultLocationId) missing.push("SHIFT_BAY_LOCATION_ID");
    throw new Error(`Supabase storage is not configured. Missing ${missing.join(", ")}.`);
  }
  return { url: url.replace(/\/$/, ""), serviceRoleKey, defaultLocationId };
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

function scheduleChangeSummary(previous = {}, next = {}) {
  const compare = (key) => {
    const before = new Map((Array.isArray(previous[key]) ? previous[key] : []).map((item) => [item.id, item]));
    const after = new Map((Array.isArray(next[key]) ? next[key] : []).map((item) => [item.id, item]));
    let created = 0;
    let edited = 0;
    let deleted = 0;
    after.forEach((item, id) => {
      if (!before.has(id)) created += 1;
      else if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) edited += 1;
    });
    before.forEach((_item, id) => { if (!after.has(id)) deleted += 1; });
    return { created, edited, deleted };
  };
  const shifts = compare("shifts");
  const openShifts = compare("unassignedShifts");
  const requestOffs = compare("timeOffRequests");
  const employees = compare("employees");
  const templates = compare("templates");
  return {
    shiftsCreated: shifts.created,
    shiftsEdited: shifts.edited,
    shiftsDeleted: shifts.deleted,
    openShiftsCreated: openShifts.created,
    openShiftsEdited: openShifts.edited,
    openShiftsDeleted: openShifts.deleted,
    requestOffsCreated: requestOffs.created,
    requestOffsEdited: requestOffs.edited,
    requestOffsDeleted: requestOffs.deleted,
    employeesChanged: employees.created + employees.edited + employees.deleted,
    templatesChanged: templates.created + templates.edited + templates.deleted
  };
}

function createSupabaseStore() {
  const config = requireSupabaseConfig();
  const documentKey = process.env.SHIFT_BAY_DOCUMENT_KEY || "primary";

  function locationFor(userOrLocationId = null) {
    if (typeof userOrLocationId === "string" && userOrLocationId) return userOrLocationId;
    return userOrLocationId?.locationId || config.defaultLocationId;
  }

  async function loadDocumentRow(select = "*", userOrLocationId = null) {
    const locationId = locationFor(userOrLocationId);
    const rows = await supabaseFetch(
      config,
      `/scheduler_state_documents?location_id=eq.${encodeURIComponent(locationId)}&document_key=eq.${encodeURIComponent(documentKey)}&select=${select}`
    );
    return Array.isArray(rows) ? rows[0] : null;
  }

  async function logAuditEvent(eventType, user, details = {}) {
    if (!user?.id) return;
    const locationId = locationFor(user);
    await supabaseFetch(config, "/audit_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        location_id: locationId,
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

    async status(userOrLocationId = null) {
      const locationId = locationFor(userOrLocationId);
      const row = await loadDocumentRow("saved_at,updated_at", locationId);
      return {
        ok: true,
        mode: "supabase",
        locationId,
        documentKey,
        updatedAt: row?.updated_at || row?.saved_at || null
      };
    },

    async loadState(userOrLocationId = null) {
      const row = await loadDocumentRow("*", userOrLocationId);
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
      const locationId = locationFor(user);
      const state = payload?.data || payload?.state || payload;
      const savedBy = user?.id || payload?.savedBy?.id || null;
      const savedByDeviceId = payload?.savedByDeviceId || state?.meta?.deviceId || null;
      const baseServerSavedAt = payload?.baseServerSavedAt || state?.meta?.serverSavedAt || "";
      const incomingTime = dataUpdatedAt(payload);
      const existingRow = await loadDocumentRow("state,saved_at,updated_at", locationId);
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
        location_id: locationId,
        document_key: documentKey,
        schema_version: Number(payload?.schemaVersion || state?.meta?.schemaVersion || 1),
        state,
        saved_by: savedBy,
        saved_by_device_id: savedByDeviceId,
        saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }];
      const changeSummary = scheduleChangeSummary(existingRow?.state || {}, state);
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
        schemaVersion: body[0].schema_version,
        changeSummary
      });
      return { ok: true, savedAt: body[0].saved_at, savedBy };
    },

    async recentAuditEvents(limit = 50, userOrLocationId = null) {
      const locationId = locationFor(userOrLocationId);
      return supabaseFetch(
        config,
        `/audit_events?location_id=eq.${encodeURIComponent(locationId)}&select=id,event_type,entity_type,details,created_at,user_id&order=created_at.desc&limit=${Number(limit) || 50}`
      );
    }
  };
}

module.exports = {
  createSupabaseStore
};
