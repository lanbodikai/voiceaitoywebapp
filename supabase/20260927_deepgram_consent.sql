begin;

-- Keep the deployed guest-action implementation intact while allowing the
-- updated parent disclosure to record its own consent version.
do $$
declare
  definition text;
  previous_versions text := '''web-research-1.1'',''web-handsfree-1.2''';
begin
  select pg_get_functiondef('public.cc_guest_action(text,jsonb)'::regprocedure) into definition;
  if position('''web-handsfree-1.3''' in definition)>0 then
    return;
  end if;
  if definition is null or position(previous_versions in definition)=0 then
    raise exception 'Unexpected cc_guest_action consent definition';
  end if;
  execute replace(definition, previous_versions,
    '''web-research-1.1'',''web-handsfree-1.2'',''web-handsfree-1.3''');
end $$;

commit;
