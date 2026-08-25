alter table public.orders
  add column if not exists release_status text,
  add column if not exists release_sent_at timestamptz,
  add column if not exists release_last_attempt_at timestamptz,
  add column if not exists release_attempts integer not null default 0,
  add column if not exists release_error text;

alter table public.orders drop constraint if exists orders_release_status_check;
alter table public.orders add constraint orders_release_status_check check (
  release_status is null or release_status in (
    'pending','sent','failed','skipped_unconfigured','pending_reject','rejected'
  )
);

create index if not exists orders_release_queue_idx
  on public.orders (release_status, release_last_attempt_at)
  where release_status in ('pending','failed','skipped_unconfigured','pending_reject');

-- Single hook for every payment route (wallet RPC, batch card settle, top-up
-- release sweep): queue the release when a middleware order becomes paid, and
-- queue a reject when it is cancelled before any release went out.
create or replace function public.queue_middleware_release()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.source <> 'middleware' or new.middleware_order_id is null then
    return new;
  end if;

  if new.status = 'paid' and old.status <> 'paid'
     and (new.release_status is null
          or new.release_status in ('failed','skipped_unconfigured')) then
    new.release_status := 'pending';
    new.release_attempts := 0;
    new.release_error := null;
    return new;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled'
     and new.release_sent_at is null
     and coalesce(new.release_status, '') <> 'sent' then
    new.release_status := 'pending_reject';
    new.release_attempts := 0;
    new.release_error := null;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists queue_middleware_release_trg on public.orders;
create trigger queue_middleware_release_trg
  before update of status on public.orders
  for each row execute function public.queue_middleware_release();