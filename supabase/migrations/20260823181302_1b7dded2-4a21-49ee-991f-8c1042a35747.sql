drop policy if exists "Clients read own documents" on public.documents;

create policy "Clients read own documents"
on public.documents
for select
to authenticated
using (
  exists (
    select 1
    from public.entities e
    where e.id = documents.entity_id
      and e.account_id = auth.uid()
  )
);