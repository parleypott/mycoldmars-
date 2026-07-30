-- 036_search_rag_chunks.sql
--
-- The pgvector retrieval RPC behind api/citations-search.js — the script-tool
-- fact-check endpoint. It was created live against the Supabase project by the
-- newpress-citations RAG pipeline; this file ends that drift so the function is
-- reproducible from source control.
--
-- Ported from the digital-studio test space (where it was numbered 033) into
-- mycoldmars production; renumbered to 036 because 032-035 are taken here by the
-- burgundy_notes series. Both repos point at the same Supabase project
-- (bqlusmhdweaaxhxwfxvj), so the function this file describes is ALREADY LIVE in
-- the database — this migration is source-control catch-up, not a pending change.
--
-- DEPENDS ON: the `rag.chunks` table (schema `rag`, column `embedding halfvec(1024)`,
-- HNSW cosine index `chunks_hnsw`), which is populated OUTSIDE this repo by the
-- newpress-citations embed pipeline (179,782 Jina-v3 chunks / 167 videos). This
-- migration creates ONLY the query function; it does not create or seed the table.
--
-- SECURITY POSTURE (important): the function is SECURITY DEFINER so it can read
-- the non-public `rag` schema. It is granted to `service_role` ONLY — NOT to
-- anon/authenticated. That is deliberate: api/citations-search.js is the single
-- door (it calls with the service key + enforces checkAccess and a per-IP rate
-- limit). Granting anon/authenticated would let anyone with the public anon key
-- call POST /rest/v1/rpc/search_rag_chunks directly and page the entire internal
-- corpus, bypassing the gate. Keep the grant service_role-only.
--
-- retrieval.query vs retrieval.passage: the corpus was embedded with Jina v3
-- task=retrieval.passage; the caller MUST embed the query with task=retrieval.query
-- (v3 is an asymmetric pair). The function is model-agnostic about that — it only
-- filters model='jina-embeddings-v3' — so the invariant lives in api/_lib/jina-embed.js.

create or replace function public.search_rag_chunks(
  query_embedding text,
  match_count int default 12,
  match_threshold float default 0.0,
  filter_video text default null,
  cited_only boolean default false
)
returns table (
  chunk_id text,
  text text,
  source_url text,
  access_method text,
  video text,
  cited boolean,
  book_title text,
  n_citations int,
  metadata jsonb,
  similarity float
)
language plpgsql
volatile
security definer
set search_path = rag, public
as $$
begin
  -- Defense in depth: bound a single call's cost regardless of grant.
  set local statement_timeout = '10s';
  -- Raise HNSW recall so sparse filtered searches (only ~1,438 of 179,782 rows
  -- are cited=true) still surface their nearest matches instead of an empty set.
  set local hnsw.ef_search = 200;
  -- pgvector 0.8 iterative scan: keep scanning past the first HNSW window until
  -- match_count rows PASS the WHERE filter. Without this, a sparse post-filter
  -- (cited_only / a rare filter_video) returns fewer rows than asked — or empty —
  -- even when matching rows exist deeper in the index (Forge audit H1).
  set local hnsw.iterative_scan = 'relaxed_order';
  return query
    select
      c.chunk_id, c.text, c.source_url, c.access_method, c.video, c.cited,
      c.book_title, c.n_citations, c.metadata,
      1 - (c.embedding <=> query_embedding::halfvec) as similarity
    from rag.chunks c
    where c.model = 'jina-embeddings-v3'
      and (filter_video is null or c.video = filter_video)
      and (not cited_only or c.cited = true)
      and (1 - (c.embedding <=> query_embedding::halfvec)) >= match_threshold
    order by c.embedding <=> query_embedding::halfvec
    limit greatest(1, least(match_count, 100));
end;
$$;

revoke execute on function public.search_rag_chunks(text,int,float,text,boolean) from anon, authenticated, public;
grant execute on function public.search_rag_chunks(text,int,float,text,boolean) to service_role;
