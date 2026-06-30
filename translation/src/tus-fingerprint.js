// Pure decision core for evicting a poisoned tus resume fingerprint.
//
// tus-js-client only clears its localStorage resume record after a SUCCESSFUL
// upload. When an upload dies mid-flight it leaves that record behind, and the
// next retry can blindly re-attach to the dead session and wedge forever at 0%
// while the server keeps accepting PATCHes. So on every terminal error we have
// to evict the record ourselves.
//
// The danger is matching too widely: nuke a DIFFERENT live upload's fingerprint
// and you wedge THAT one too. This function decides, per localStorage record,
// whether it belongs to the file currently being (re)uploaded. It is the exact
// per-key predicate db.js's clearTusFingerprint() runs in its loop — extracted
// here so it can be tested without booting Supabase.

// Normalize a filename into the needle used for fuzzy fingerprint matching:
// lowercase, then strip everything that isn't a word char, dot, or hyphen.
// (tus fingerprints embed a sanitized form of the name, so the raw filename
// with spaces/parens won't substring-match the stored key directly.)
export function makeFileNameNeedle(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/[^\w.-]/g, '');
}

// Decide whether a single `tus::`-prefixed localStorage record (`key` + its
// parsed JSON value) belongs to the upload described by `ctx`.
//   ctx.path           — the exact storage object path of the current upload
//   ctx.bucket         — the current upload's bucket name
//   ctx.endpoint       — the resumable-upload endpoint URL
//   ctx.fileNameNeedle — makeFileNameNeedle(file.name || path basename)
//   ctx.staleUploadUrl — (optional) a known-dead session URL to force-evict
//
// Matching ladder (widening, each rung only tried if earlier ones miss):
//   1. exact object-path match — the strong, unambiguous signal;
//   2. fuzzy: the record's key/fingerprint contains the filename needle AND it
//      agrees on bucket or endpoint (needle alone is too loose to evict on);
//   3. it IS the specific stale session URL we just failed.
export function matchesTusFingerprintKey(key, parsed, ctx) {
  const { path, bucket, endpoint, fileNameNeedle, staleUploadUrl } = ctx || {};
  if (typeof key !== 'string' || !key.startsWith('tus::')) return false;

  const metadata = (parsed && parsed.metadata) || {};
  const storedObjectName = metadata.objectName;
  const storedBucketName = metadata.bucketName;
  const storedUploadUrl = parsed && parsed.uploadUrl;
  const storedFingerprint = String((parsed && parsed.fingerprint) || '').toLowerCase();
  const fingerprintHaystack = `${key.toLowerCase()} ${storedFingerprint}`;

  let matchesFile = storedObjectName === path;
  if (!matchesFile && fileNameNeedle && fingerprintHaystack.includes(fileNameNeedle)) {
    matchesFile = storedBucketName === bucket ||
                  storedUploadUrl?.startsWith(endpoint) ||
                  key.includes(endpoint);
  }
  if (!matchesFile && staleUploadUrl && storedUploadUrl === staleUploadUrl) {
    matchesFile = true;
  }
  return matchesFile;
}
