alter table public.spymarket_subscriptions drop constraint spymarket_subscriptions_plan_check;
alter table public.spymarket_subscriptions add constraint spymarket_subscriptions_plan_check check (plan = any (array['module'::text,'starter'::text,'plus'::text,'max'::text]));
alter type public.spymarket_plan add value if not exists 'module';