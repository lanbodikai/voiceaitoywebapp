begin;
create extension if not exists pgcrypto with schema extensions;

create table public.cc_checkpoint_catalog (
  story_id text not null, beat_id text not null, checkpoint_id text not null,
  reward_id text not null, vocabulary_ids text[] not null,
  primary key(story_id, beat_id)
);
create table public.cc_guest_profiles (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  consent_version text not null, consented_at timestamptz not null default now(),
  recovery_hash text unique
);
create table public.cc_guest_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_id uuid not null references public.cc_guest_profiles(id) on delete cascade
);
create table public.cc_sessions (
  id uuid primary key, profile_id uuid not null references public.cc_guest_profiles(id),
  mode text not null check (mode in ('story','play')), story_id text,
  language text not null check (language in ('chinese','english')),
  visual text not null check (visual in ('voice','pictures')),
  started_at timestamptz not null default clock_timestamp(), ended_at timestamptz
);
create index cc_sessions_profile_idx on public.cc_sessions(profile_id, started_at);
create table public.cc_story_progress (
  profile_id uuid not null references public.cc_guest_profiles(id), story_id text not null,
  language text not null check(language in ('chinese','english')),
  session_id uuid not null references public.cc_sessions(id), revision bigint not null,
  snapshot jsonb not null, updated_at timestamptz not null default now(),
  primary key(profile_id,story_id,language)
);
create table public.cc_checkpoint_events (
  session_id uuid not null references public.cc_sessions(id), sequence integer not null check(sequence between 1 and 10000),
  kind text not null check(kind in ('answer_evaluated','hint_played','mercy_fired','unusable_audio','sticker_earned','branch_taken','beat_advanced','session_ended','checkpoint_completed','transcription_completed','comfort_fired','play_turn')),
  checkpoint_id text, verdict text check(verdict in ('correct','meaningUnderstood','partial','incorrect','uncertain','unusable','offTopic')),
  hint_level integer check(hint_level between 0 and 4), audio_ms integer check(audio_ms between 0 and 30000),
  latency_ms integer check(latency_ms between 0 and 120000), created_at timestamptz not null default now(),
  primary key(session_id,sequence)
);

alter table public.cc_checkpoint_catalog enable row level security;
alter table public.cc_guest_profiles enable row level security;
alter table public.cc_guest_members enable row level security;
alter table public.cc_sessions enable row level security;
alter table public.cc_story_progress enable row level security;
alter table public.cc_checkpoint_events enable row level security;
revoke all on public.cc_checkpoint_catalog, public.cc_guest_profiles, public.cc_guest_members, public.cc_sessions, public.cc_story_progress, public.cc_checkpoint_events from anon, authenticated;

-- One restricted RPC exposes only records belonging to the verified caller.
-- No service-role credential or raw text storage is required by the web app.
create function public.cc_guest_action(p_action text, p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); pid uuid; sid uuid; sess public.cc_sessions;
  e jsonb; snap jsonb; cp text; code text; target uuid; rev bigint;
begin
  if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select profile_id into pid from public.cc_guest_members where user_id=uid;

  if p_action='consent' then
    if p_input->>'version' is distinct from 'web-research-1.1' then raise exception 'Invalid consent'; end if;
    if pid is null then
      insert into public.cc_guest_profiles(consent_version) values('web-research-1.1') returning id into pid;
      insert into public.cc_guest_members(user_id,profile_id) values(uid,pid);
    else
      update public.cc_guest_profiles set consent_version='web-research-1.1',consented_at=now() where id=pid;
    end if;
    return jsonb_build_object('participantID',pid);
  end if;
  if pid is null then raise exception 'Consent required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(pid::text,1));

  if p_action='load' then
    return jsonb_build_object('profileID',pid,'stories',coalesce((select jsonb_agg(jsonb_build_object('storyID',story_id,'language',language,'snapshot',snapshot,'updatedAt',updated_at)) from public.cc_story_progress where profile_id=pid),'[]'::jsonb));
  elsif p_action='recovery_create' then
    code := encode(extensions.gen_random_bytes(20),'hex');
    update public.cc_guest_profiles set recovery_hash=encode(extensions.digest(code,'sha256'),'hex') where id=pid;
    return jsonb_build_object('code',code);
  elsif p_action='recovery_restore' then
    code := lower(replace(p_input->>'code','-',''));
    if code is null or code !~ '^[a-f0-9]{40}$' then raise exception 'Invalid recovery code'; end if;
    select id into target from public.cc_guest_profiles where recovery_hash=encode(extensions.digest(code,'sha256'),'hex');
    if target is null then raise exception 'Invalid recovery code'; end if;
    update public.cc_guest_members set profile_id=target where user_id=uid;
    return jsonb_build_object('profileID',target);
  elsif p_action='start' then
    if p_input->>'mode'='story' and not exists(select 1 from public.cc_checkpoint_catalog where story_id=p_input->>'storyID') then raise exception 'Unknown story'; end if;
    sid := (p_input->>'sessionID')::uuid;
    insert into public.cc_sessions(id,profile_id,mode,story_id,language,visual)
      values(sid,pid,p_input->>'mode',case when p_input->>'mode'='story' then p_input->>'storyID' else null end,p_input->>'language',p_input->>'visual');
    return jsonb_build_object('sessionID',sid);
  elsif p_action='save' then
    sid := (p_input->>'sessionID')::uuid;
    select * into sess from public.cc_sessions where id=sid and profile_id=pid for update;
    if not found then raise exception 'Session not found' using errcode='42501'; end if;
    if jsonb_typeof(p_input->'events') is distinct from 'array' or jsonb_array_length(p_input->'events')>100 then raise exception 'Invalid events'; end if;
    for e in select value from jsonb_array_elements(p_input->'events') loop
      cp := null;
      if e->>'beatID' is not null then
        select checkpoint_id into cp from public.cc_checkpoint_catalog where story_id=sess.story_id and beat_id=e->>'beatID';
        if cp is null then raise exception 'Unknown checkpoint'; end if;
      end if;
      insert into public.cc_checkpoint_events(session_id,sequence,kind,checkpoint_id,verdict,hint_level,audio_ms,latency_ms)
      values(sid,(e->>'sequence')::integer,e->>'kind',cp,e->>'verdict',(e->>'hintLevel')::integer,(e->>'audioMs')::integer,(e->>'latencyMs')::integer)
      on conflict(session_id,sequence) do nothing;
      if e->>'kind'='session_ended' then update public.cc_sessions set ended_at=coalesce(ended_at,now()) where id=sid; end if;
    end loop;
    snap := p_input->'snapshot';
    if snap is not null and snap <> 'null'::jsonb then
      if sess.mode <> 'story' then raise exception 'Only stories have checkpoints'; end if;
      if jsonb_typeof(snap) <> 'object' or exists(select 1 from jsonb_object_keys(snap) k where k not in ('beatID','phase','attemptCount','hintLevel','completed','beatPath','completedCheckpoints','rewardIDs','vocabularyIDs')) then raise exception 'Invalid progress fields'; end if;
      if not exists(select 1 from public.cc_checkpoint_catalog where story_id=sess.story_id and beat_id=snap->>'beatID') or coalesce(snap->>'phase','') not in ('story','recast') then raise exception 'Invalid position'; end if;
      if coalesce((snap->>'attemptCount')::integer,-1) not between 0 and 10000 or coalesce((snap->>'hintLevel')::integer,-1) not between 0 and 4 or jsonb_typeof(snap->'completed') is distinct from 'boolean' then raise exception 'Invalid counters'; end if;
      if jsonb_typeof(snap->'beatPath') is distinct from 'array' or jsonb_typeof(snap->'completedCheckpoints') is distinct from 'array' or jsonb_typeof(snap->'rewardIDs') is distinct from 'array' or jsonb_typeof(snap->'vocabularyIDs') is distinct from 'array' then raise exception 'Invalid lists'; end if;
      if jsonb_array_length(snap->'beatPath')>20 or jsonb_array_length(snap->'completedCheckpoints')>30 or jsonb_array_length(snap->'rewardIDs')>30 or jsonb_array_length(snap->'vocabularyIDs')>100 then raise exception 'Progress too large'; end if;
      if exists(select 1 from jsonb_array_elements_text(snap->'beatPath') v where not exists(select 1 from public.cc_checkpoint_catalog where story_id=sess.story_id and beat_id=v))
      or exists(select 1 from jsonb_array_elements_text(snap->'completedCheckpoints') v where not exists(select 1 from public.cc_checkpoint_catalog where story_id=sess.story_id and checkpoint_id=v))
      or exists(select 1 from jsonb_array_elements_text(snap->'rewardIDs') v where not exists(select 1 from public.cc_checkpoint_catalog where story_id=sess.story_id and reward_id=v))
      or exists(select 1 from jsonb_array_elements_text(snap->'vocabularyIDs') v where not exists(select 1 from public.cc_checkpoint_catalog where story_id=sess.story_id and v=any(vocabulary_ids))) then raise exception 'Unknown progress ID'; end if;
      rev := (p_input->>'revision')::bigint;
      if rev is null or rev<0 then raise exception 'Invalid revision'; end if;
      -- Late uploads from an older visit retain events without rewinding a newer visit.
      if not exists(select 1 from public.cc_sessions where profile_id=pid and story_id=sess.story_id and language=sess.language and started_at>sess.started_at) then
        insert into public.cc_story_progress(profile_id,story_id,language,session_id,revision,snapshot)
        values(pid,sess.story_id,sess.language,sid,rev,snap)
        on conflict(profile_id,story_id,language) do update set session_id=sid,revision=rev,snapshot=excluded.snapshot,updated_at=now()
        where cc_story_progress.session_id<>sid or cc_story_progress.revision<rev;
      end if;
    end if;
    return jsonb_build_object('saved',true);
  end if;
  raise exception 'Unknown action';
end;
$$;
revoke all on function public.cc_guest_action(text,jsonb) from public,anon;
grant execute on function public.cc_guest_action(text,jsonb) to authenticated;

-- Admin-only view: one row per checkpoint per visit, no learner utterances.
create view public.cc_checkpoint_summary with (security_invoker=true) as
select s.profile_id,s.id as session_id,s.story_id,s.language,e.checkpoint_id,
 count(*) filter(where e.kind='answer_evaluated') as attempts,
 count(*) filter(where e.kind='hint_played') as hints_used,
 count(*) filter(where e.verdict in ('incorrect','partial')) as struggled_answers,
 bool_or(e.kind='checkpoint_completed') as completed,
 bool_or(e.kind='mercy_fired') as needed_assistance,
 max(e.created_at) as last_activity
from public.cc_sessions s join public.cc_checkpoint_events e on e.session_id=s.id
where e.checkpoint_id is not null group by s.profile_id,s.id,s.story_id,s.language,e.checkpoint_id;
revoke all on public.cc_checkpoint_summary from anon,authenticated;
insert into public.cc_checkpoint_catalog(story_id,beat_id,checkpoint_id,reward_id,vocabulary_ids) values
('choochoo-birthday-cake','call-a-friend','call-a-friend','reward-phone',array['make-phone-call','friend']::text[]),
('choochoo-birthday-cake','fox-kitchen','fox-list','reward-fox',array['list','apron']::text[]),
('choochoo-birthday-cake','yanli-song','yanli-practice','reward-pony',array['birthday-song','practice']::text[]),
('choochoo-birthday-cake','panpan-pickup','panpan-car-color','reward-panpan',array['yellow','drive']::text[]),
('choochoo-birthday-cake','gather-ingredients','panpan-strawberries','reward-strawberry',array['strawberry','bring-back']::text[]),
('choochoo-birthday-cake','mix-batter','milk-and-stir','reward-bowl',array['pour-milk','stir']::text[]),
('choochoo-birthday-cake','birthday-party','your-birthday-cake','reward-cake',array['cake','birthday']::text[]),
('choochoo-farm-duckling','farm-arrival','farm-helper','reward-tractor',array['help','farm']::text[]),
('choochoo-farm-duckling','dog-nose','dog-smell','reward-dog',array['nose','smell']::text[]),
('choochoo-farm-duckling','hen-yard','hen-footprints','reward-hen',array['footprint','find']::text[]),
('choochoo-farm-duckling','foal-run','foal-yellow','reward-foal',array['yellow','run']::text[]),
('choochoo-farm-duckling','pond-search','duck-sound','reward-lotus',array['quack','listen']::text[]),
('choochoo-farm-duckling','bring-home','help-gaga','reward-scarf',array['hug-carry','go-home']::text[]),
('choochoo-farm-duckling','farm-dinner','your-animal','reward-gaga',array['animal','like']::text[]),
('choochoo-noodle-shop','shop-opening','pick-dish','reward-bell',array['noodles','dumplings']::text[]),
('choochoo-noodle-shop','make-noodles','long-noodles','reward-noodles',array['long','pull']::text[]),
('choochoo-noodle-shop','make-dumplings','count-dumplings','reward-dumplings',array['three','wrap']::text[]),
('choochoo-noodle-shop','hot-soup','blow-on-it','reward-spoon',array['blow','hot']::text[]),
('choochoo-noodle-shop','happy-customer','bengbeng-thanks','reward-carrot',array['thank-you','yummy']::text[]),
('choochoo-noodle-shop','your-food','your-favorite-food','reward-lantern',array['eat','hungry']::text[]);
commit;
