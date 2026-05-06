-- Migration: Add google_docs support to media_assets constraints
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_tier_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_tier_check CHECK (tier IN ('raw', 'script', 'selects', 'finished', 'google_docs'));

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_source_kind_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_source_kind_check CHECK (source_kind IN ('dropbox', 'youtube', 'local', 'google_docs'));
