const fs = require("fs");
const path = require("path");

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function dataUpdatedAt(payload) {
  return Date.parse(payload?.data?.meta?.updatedAt || payload?.state?.meta?.updatedAt || payload?.meta?.updatedAt || payload?.savedAt || "");
}

function createLocalJsonStore(options) {
  const dataDir = options.dataDir;
  const backupDir = options.backupDir;
  const dataFile = options.dataFile;

  function ensureFolders() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });
  }

  function existingUpdatedAt() {
    if (!fs.existsSync(dataFile)) return 0;
    try {
      return dataUpdatedAt(JSON.parse(fs.readFileSync(dataFile, "utf8")));
    } catch {
      return 0;
    }
  }

  return {
    mode: "local-json",

    async status() {
      const exists = fs.existsSync(dataFile);
      return {
        ok: true,
        mode: "local-json",
        dataFile,
        exists,
        updatedAt: exists ? fs.statSync(dataFile).mtime.toISOString() : null
      };
    },

    async loadState() {
      if (!fs.existsSync(dataFile)) {
        return { exists: false };
      }
      return {
        exists: true,
        payload: JSON.parse(fs.readFileSync(dataFile, "utf8"))
      };
    },

    async saveState(payload) {
      ensureFolders();
      const incomingTime = dataUpdatedAt(payload);
      const existingTime = existingUpdatedAt();
      if (incomingTime && existingTime && incomingTime < existingTime - 1000) {
        return {
          ok: false,
          stale: true,
          incomingUpdatedAt: new Date(incomingTime).toISOString(),
          existingUpdatedAt: new Date(existingTime).toISOString()
        };
      }
      if (fs.existsSync(dataFile)) {
        const backupName = `restaurant-scheduler-data-${timestampForFile()}.json`;
        fs.copyFileSync(dataFile, path.join(backupDir, backupName));
      }
      const tempFile = `${dataFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tempFile, dataFile);
      return { ok: true, savedAt: new Date().toISOString() };
    }
  };
}

module.exports = {
  createLocalJsonStore,
  dataUpdatedAt
};
