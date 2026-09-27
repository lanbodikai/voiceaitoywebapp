begin;

-- The voice runtime checks the recorded version before routing speech to
-- Deepgram. Preserve every other part of the deployed guest-action function.
do $$
declare
  definition text;
  anchor text := '''profileID'',pid,';
begin
  select pg_get_functiondef('public.cc_guest_action(text,jsonb)'::regprocedure) into definition;
  if position('''consentVersion''' in definition)>0 then
    return;
  end if;
  if definition is null or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Unexpected cc_guest_action load response';
  end if;
  execute replace(definition,anchor,
    '''profileID'',pid,''consentVersion'',(select consent_version from public.cc_guest_profiles where id=pid),');
end $$;

commit;
