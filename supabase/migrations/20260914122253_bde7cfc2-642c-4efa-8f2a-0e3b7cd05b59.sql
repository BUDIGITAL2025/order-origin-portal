alter table public.quote_lines drop constraint quote_lines_sourced_by_fkey,
  add constraint quote_lines_sourced_by_fkey foreign key (sourced_by) references auth.users(id) on delete set null;

alter table public.quote_requests drop constraint quote_requests_assigned_sourcer_fkey,
  add constraint quote_requests_assigned_sourcer_fkey foreign key (assigned_sourcer) references auth.users(id) on delete set null;

alter table public.ads_api_calls drop constraint ads_api_calls_called_by_fkey,
  add constraint ads_api_calls_called_by_fkey foreign key (called_by) references auth.users(id) on delete set null;