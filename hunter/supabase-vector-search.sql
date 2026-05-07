-- Hunter: Server-side semantic search via pgvector cosine similarity
-- Run this in the Supabase SQL Editor (Dashboard → SQL)
-- Replaces client-side cosine similarity with server-side <=> operator

-- Create the search function
create or replace function search_corpus_embeddings(
  query_embedding vector(768),
  match_threshold float default 0.3,
  match_count int default 20,
  filter_tier text default null,
  filter_project_id uuid default null
)
returns table (
  corpus_unit_id uuid,
  similarity float,
  clip_name text,
  start_seconds numeric,
  end_seconds numeric,
  tier text,
  project_id uuid,
  project_name text,
  analysis_preview text
)
language plpgsql
as $$
begin
  return query
  select
    e.corpus_unit_id,
    1 - (e.embedding <=> query_embedding) as similarity,
    cu.source_clip_name as clip_name,
    cu.start_seconds,
    cu.end_seconds,
    ma.tier,
    ma.project_id,
    hp.name as project_name,
    left(a.output_text, 400) as analysis_preview
  from embeddings e
  join corpus_units cu on cu.id = e.corpus_unit_id
  join media_assets ma on ma.id = cu.media_asset_id
  join hunter_projects hp on hp.id = ma.project_id
  left join lateral (
    select output_text from analyses
    where analyses.corpus_unit_id = e.corpus_unit_id
    order by created_at desc
    limit 1
  ) a on true
  where 1 - (e.embedding <=> query_embedding) > match_threshold
    and (filter_tier is null or ma.tier = filter_tier)
    and (filter_project_id is null or ma.project_id = filter_project_id)
  order by e.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Create an IVFFlat index for faster similarity search
-- (with ~6000 embeddings, this gives a major speedup)
create index if not exists idx_embeddings_ivfflat
  on embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- Grant execute to anon role
grant execute on function search_corpus_embeddings to anon;
grant execute on function search_corpus_embeddings to authenticated;
