// Soft-delete semantics for script_projects — the "nobody can hard-delete, everything is
// restorable" contract (Johnny's order after the audit found any pool member could DELETE a
// project and cascade away its append-only revision history).
//
// The columns are ADDITIVE (migration script_projects_soft_delete): deleted_at timestamptz,
// deleted_by uuid — both nullable, so every pre-existing row reads as "not deleted". A row is
// in the TRASH when it is trashed OR deleted; it is ACTIVE only when it is neither. The API's
// DELETE verb now writes these fields via PATCH — no code path issues a REST DELETE against
// script_projects anymore, so the FK cascade onto script_docs / script_doc_revisions /
// script_presence can never fire.
//
// Pure module: no fetch, no env — safe to import from tests and from any endpoint.

/**
 * PostgREST filter for the ACTIVE library list: not trashed AND not deleted.
 * (Two ANDed top-level params — PostgREST ANDs query params by default.)
 */
export const ACTIVE_LIST_FILTER = 'trashed_at=is.null&deleted_at=is.null';

/**
 * PostgREST filter for the TRASH list: trashed OR deleted. Deleted rows surface here so the
 * existing client trash UI shows them (and can Restore them) — a "deleted" project is just a
 * deeper shade of trash, never gone.
 */
export const TRASH_LIST_FILTER = 'or=(trashed_at.not.is.null,deleted_at.not.is.null)';

/**
 * The PATCH body that soft-deletes a project. Stamps WHO deleted it (Supabase auth user id,
 * or null for access-code / dev-mode callers — attribution only, never access control).
 * trashed_at is preserved if the row was already in the trash (keeps its "Nd left" clock
 * honest), otherwise set now so the row lands in the trash view immediately.
 */
export function softDeleteFields(userId, nowIso, existingTrashedAt = null) {
  const iso = nowIso || new Date().toISOString();
  return {
    deleted_at: iso,
    deleted_by: (typeof userId === 'string' && userId) ? userId : null,
    trashed_at: existingTrashedAt || iso,
    updated_at: iso,
  };
}

/**
 * The PATCH body that fully restores a project out of the trash: clears BOTH the trash flag
 * and the soft-delete flag (and its attribution). Restore must always win — a row restored
 * from the trash view goes straight back to the active library.
 */
export function restoreFields(nowIso) {
  return {
    trashed_at: null,
    deleted_at: null,
    deleted_by: null,
    updated_at: nowIso || new Date().toISOString(),
  };
}

/** Is this row (wire or DB shape) in the trash? Trashed OR soft-deleted. */
export function isTrashRow(row) {
  return !!(row && (row.trashed_at || row.deleted_at));
}
