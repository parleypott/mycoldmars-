-- 023_nile_flights_state.sql
-- Booking-tracker state for /nile-flights.
--
-- Single-row blob keyed by id='singleton' holding the booking map:
--   { bookings: { [legId]: { booked: true, by: 'Marisa', at: '<iso>' } } }
--
-- Johnny's EA (Marisa) opens /nile-flights and ticks off each flight as she
-- books it; the check turns green + crosses out, synced here so Johnny sees it.
-- Mirrors winchester_state (022). Safe to re-run.

create table if not exists public.nile_flights_state (
  id          text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

insert into public.nile_flights_state (id, state)
values ('singleton', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.nile_flights_state enable row level security;

drop policy if exists "nile_flights_state read"   on public.nile_flights_state;
drop policy if exists "nile_flights_state write"  on public.nile_flights_state;
drop policy if exists "nile_flights_state update" on public.nile_flights_state;

create policy "nile_flights_state read"
  on public.nile_flights_state for select
  to anon, authenticated using (true);
create policy "nile_flights_state write"
  on public.nile_flights_state for insert
  to anon, authenticated with check (true);
create policy "nile_flights_state update"
  on public.nile_flights_state for update
  to anon, authenticated using (true) with check (true);

create or replace function public.bump_nile_flights_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_nile_flights_state_updated_at on public.nile_flights_state;
create trigger trg_nile_flights_state_updated_at
  before update on public.nile_flights_state
  for each row execute function public.bump_nile_flights_state_updated_at();
