begin;

-- Preserve the deployed guest-action function while allowing the new parent
-- disclosure. Apply before releasing web-handsfree-1.4 clients.
do $$
declare
  definition text;
  previous_versions text := '''web-research-1.1'',''web-handsfree-1.2'',''web-handsfree-1.3''';
begin
  select pg_get_functiondef('public.cc_guest_action(text,jsonb)'::regprocedure) into definition;
  if position('''web-handsfree-1.4''' in definition)>0 then
    return;
  end if;
  if definition is null or (length(definition)-length(replace(definition,previous_versions,'')))/length(previous_versions)<>1 then
    raise exception 'Unexpected cc_guest_action consent definition';
  end if;
  execute replace(definition, previous_versions,
    '''web-research-1.1'',''web-handsfree-1.2'',''web-handsfree-1.3'',''web-handsfree-1.4''');
end $$;

commit;
