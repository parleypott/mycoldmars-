import { readFileSync } from 'fs';
import { join } from 'path';
const envPath = join(import.meta.dirname, '..', '.env');
const lines = readFileSync(envPath, 'utf8').split('\n');
for (const l of lines) { const m = l.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const GDOC_ASSET = '793765b5-a5c0-4610-850d-49b9d3db6f6b';
const RAW_ASSET = '51c7af61-6c96-419f-a242-638ef0063324';

const { data: gdoc } = await sb.from('media_assets').select('queue_status').eq('id', GDOC_ASSET).single();
console.log('Google Docs status:', gdoc?.queue_status);

const { count: gdocUnits } = await sb.from('corpus_units').select('*', { count: 'exact', head: true }).eq('media_asset_id', GDOC_ASSET);
console.log('Script corpus units:', gdocUnits);

const { data: raw } = await sb.from('media_assets').select('queue_status').eq('id', RAW_ASSET).single();
const { count: rawAnalyses } = await sb.from('analyses').select('*', { count: 'exact', head: true });
const { count: rawUnits } = await sb.from('corpus_units').select('*', { count: 'exact', head: true }).eq('media_asset_id', RAW_ASSET);
console.log(`Raw: ${raw?.queue_status} | ${rawAnalyses} total analyses / ${rawUnits} units`);
