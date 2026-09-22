-- Register the two supplied stories without changing existing sessions or access policies.
begin;
insert into public.cc_checkpoint_catalog(story_id,beat_id,checkpoint_id,reward_id,vocabulary_ids) values
('little-red-hen','red-hen-seed','red-hen-seed','legacy-red-hen-seed',array['wheat-seed','plant']::text[]),
('little-red-hen','red-hen-harvest','red-hen-harvest','legacy-red-hen-harvest',array['harvest','wheat']::text[]),
('little-red-hen','red-hen-flour','red-hen-flour','legacy-red-hen-flour',array['flour','mill']::text[]),
('little-red-hen','red-hen-bread','red-hen-bread','legacy-red-hen-bread',array['bread','recipe']::text[]),
('little-red-hen','red-hen-finish','red-hen-finish','legacy-red-hen-finish',array['help','chick']::text[]),
('henny-penny','penny-acorn','penny-acorn','legacy-penny-acorn',array['acorn','sky']::text[]),
('henny-penny','penny-king','penny-king','legacy-penny-king',array['king','together']::text[]),
('henny-penny','penny-friends','penny-friends','legacy-penny-friends',array['look','friend']::text[]),
('henny-penny','penny-fox','penny-fox','legacy-penny-fox',array['fox','shortcut']::text[]),
('henny-penny','penny-stop','penny-stop','legacy-penny-stop',array['goose','stop']::text[]),
('henny-penny','penny-home','penny-home','legacy-penny-home',array['home','think']::text[])
on conflict (story_id,beat_id) do update
set checkpoint_id=excluded.checkpoint_id,
    reward_id=excluded.reward_id,
    vocabulary_ids=excluded.vocabulary_ids;
commit;
