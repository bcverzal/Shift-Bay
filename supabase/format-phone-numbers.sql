-- Normalize existing North American phone values once.
-- Values with exactly 10 digits, or 11 digits beginning with 1, become:
-- (###) ###-####. Other values are left untouched for manual review.

update public.employees
set phone = case
  when length(regexp_replace(phone, '\D', '', 'g')) = 11
    then '(' || substr(regexp_replace(phone, '\D', '', 'g'), 2, 3)
      || ') ' || substr(regexp_replace(phone, '\D', '', 'g'), 5, 3)
      || '-' || substr(regexp_replace(phone, '\D', '', 'g'), 8, 4)
  else '(' || substr(regexp_replace(phone, '\D', '', 'g'), 1, 3)
    || ') ' || substr(regexp_replace(phone, '\D', '', 'g'), 4, 3)
    || '-' || substr(regexp_replace(phone, '\D', '', 'g'), 7, 4)
end
where length(regexp_replace(phone, '\D', '', 'g')) = 10
   or (length(regexp_replace(phone, '\D', '', 'g')) = 11
       and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1');

update public.staff_accounts
set phone = case
  when length(regexp_replace(phone, '\D', '', 'g')) = 11
    then '(' || substr(regexp_replace(phone, '\D', '', 'g'), 2, 3)
      || ') ' || substr(regexp_replace(phone, '\D', '', 'g'), 5, 3)
      || '-' || substr(regexp_replace(phone, '\D', '', 'g'), 8, 4)
  else '(' || substr(regexp_replace(phone, '\D', '', 'g'), 1, 3)
    || ') ' || substr(regexp_replace(phone, '\D', '', 'g'), 4, 3)
    || '-' || substr(regexp_replace(phone, '\D', '', 'g'), 7, 4)
end
where length(regexp_replace(phone, '\D', '', 'g')) = 10
   or (length(regexp_replace(phone, '\D', '', 'g')) = 11
       and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1');

-- The compatibility scheduler document also carries a copy of employee
-- profiles. Normalize that copy so old browser/state reads do not reintroduce
-- the unformatted value after the normalized tables are cleaned up.
with normalized_documents as (
  select
    d.id,
    jsonb_agg(
      case
        when length(regexp_replace(coalesce(employee->>'phone', ''), '\D', '', 'g')) = 10 then
          jsonb_set(employee, '{phone}', to_jsonb(
            '(' || substr(regexp_replace(employee->>'phone', '\D', '', 'g'), 1, 3)
              || ') ' || substr(regexp_replace(employee->>'phone', '\D', '', 'g'), 4, 3)
              || '-' || substr(regexp_replace(employee->>'phone', '\D', '', 'g'), 7, 4)
          ))
        when length(regexp_replace(coalesce(employee->>'phone', ''), '\D', '', 'g')) = 11
          and left(regexp_replace(employee->>'phone', '\D', '', 'g'), 1) = '1' then
          jsonb_set(employee, '{phone}', to_jsonb(
            '(' || substr(regexp_replace(employee->>'phone', '\D', '', 'g'), 2, 3)
              || ') ' || substr(regexp_replace(employee->>'phone', '\D', '', 'g'), 5, 3)
              || '-' || substr(regexp_replace(employee->>'phone', '\D', '', 'g'), 8, 4)
          ))
        else employee
      end order by ordinality
    ) as employees
  from public.scheduler_state_documents d
  cross join lateral jsonb_array_elements(coalesce(d.state->'employees', '[]'::jsonb)) with ordinality as rows(employee, ordinality)
  group by d.id
)
update public.scheduler_state_documents d
set state = jsonb_set(d.state, '{employees}', normalized_documents.employees),
    updated_at = now()
from normalized_documents
where d.id = normalized_documents.id;
