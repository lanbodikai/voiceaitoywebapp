-- Apply before deploying the web puzzle client so its structured events are accepted.
begin;
alter table public.cc_checkpoint_events
  drop constraint if exists cc_checkpoint_events_kind_check;
alter table public.cc_checkpoint_events
  add constraint cc_checkpoint_events_kind_check check(kind in (
    'answer_evaluated','hint_played','mercy_fired','unusable_audio','sticker_earned',
    'branch_taken','beat_advanced','session_ended','checkpoint_completed',
    'puzzle_piece_earned','puzzle_assembled','transcription_completed','comfort_fired','play_turn'
  ));
commit;
