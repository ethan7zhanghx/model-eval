function normalizeStorageNamespace(value = process.env.DATA_NAMESPACE) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function namespacedKey(key, namespace = process.env.DATA_NAMESPACE) {
  const normalized = normalizeStorageNamespace(namespace);
  return normalized ? `${normalized}:${key}` : key;
}

module.exports = {
  namespacedKey,
  normalizeStorageNamespace,
};
