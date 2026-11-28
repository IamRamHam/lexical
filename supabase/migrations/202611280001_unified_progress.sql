-- Lexical v1.1 keeps one learning state per word across every answer method.
-- The earlier per-method rows remain untouched as an audit-compatible legacy
-- source. This migration copies their combined state into a new table.
begin;

create table public.lexical_word_progress (
  user_id uuid not null references public.lexical_profiles(user_id) on delete cascade,
  word_id text not null check (word_id ~ '^lex_[0-9a-f]{32}$'),
  state jsonb not null,
  primary key (user_id, word_id),
  check (jsonb_typeof(state) = 'object'
    and state ?& array['correct','incorrect','streak','bar','mastered','lastAnswered','halfLife','due']
    and (state->>'correct')::bigint >= 0 and (state->>'incorrect')::bigint >= 0
    and (state->>'bar')::integer between 0 and 100
    and jsonb_typeof(state->'mastered') = 'boolean'
    and (state->>'streak')::integer is not null
    and (state->>'lastAnswered')::bigint >= 0
    and (state->>'halfLife')::bigint > 0
    and (state->>'due')::bigint >= (state->>'lastAnswered')::bigint)
);

with ranked as (
  select user_id, word_id, state,
    row_number() over (partition by user_id, word_id order by (state->>'lastAnswered')::bigint desc, method) as recent,
    sum((state->>'correct')::bigint) over (partition by user_id, word_id) as total_correct,
    sum((state->>'incorrect')::bigint) over (partition by user_id, word_id) as total_incorrect
  from public.lexical_progress
)
insert into public.lexical_word_progress (user_id, word_id, state)
select user_id, word_id,
  jsonb_set(jsonb_set(state, '{correct}', to_jsonb(total_correct)), '{incorrect}', to_jsonb(total_incorrect))
from ranked where recent = 1;

alter table public.lexical_word_progress enable row level security;
revoke all on public.lexical_word_progress from public, anon, authenticated;
grant select on public.lexical_word_progress to authenticated;
create policy own_word_progress on public.lexical_word_progress for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.lexical_snapshot(p_account uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  profile public.lexical_profiles%rowtype;
begin
  if owner_id is null or p_account is distinct from owner_id then
    raise exception 'Account does not match the signed-in user' using errcode = '42501';
  end if;
  insert into public.lexical_profiles (user_id) values (owner_id) on conflict do nothing;
  select * into strict profile from public.lexical_profiles where user_id = owner_id for share;
  return jsonb_build_object(
    'revision', profile.revision, 'settings', profile.settings, 'session', profile.lesson,
    'progress', coalesce((select jsonb_object_agg(word_id, state)
      from public.lexical_word_progress where user_id = owner_id), '{}'::jsonb),
    'days', coalesce((select jsonb_object_agg(day, answers) from public.lexical_days where user_id = owner_id), '{}'::jsonb),
    'tags', coalesce((select jsonb_object_agg(word_id, true) from public.lexical_tags where user_id = owner_id), '{}'::jsonb)
  );
end;
$$;

create or replace function public.lexical_commit(p_account uuid, p_revision bigint, p_client uuid,
  p_sequence bigint, p_patch jsonb, p_guest uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_revision bigint;
  current_lesson jsonb;
  previous_sequence bigint;
  imported_count bigint;
  rejected_import boolean := false;
begin
  if owner_id is null or p_account is distinct from owner_id then
    raise exception 'Account does not match the signed-in user' using errcode = '42501';
  end if;
  if p_client is null or p_sequence is null or p_sequence < 1 or p_revision is null
      or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Invalid learning update' using errcode = '22023';
  end if;
  insert into public.lexical_profiles (user_id) values (owner_id) on conflict do nothing;
  select revision, lesson into strict current_revision, current_lesson
    from public.lexical_profiles where user_id = owner_id for update;
  select last_sequence into previous_sequence from public.lexical_clients
    where user_id = owner_id and client_id = p_client;
  if p_sequence <= coalesce(previous_sequence, 0) then return jsonb_build_object('status', 'duplicate', 'revision', current_revision); end if;
  if p_sequence <> coalesce(previous_sequence, 0) + 1 then raise exception 'Invalid client sequence' using errcode = '22023'; end if;
  if p_revision <> current_revision then return jsonb_build_object('status', 'conflict', 'revision', current_revision); end if;
  if p_guest is not null then
    insert into public.lexical_imports (guest_id, user_id) values (p_guest, owner_id) on conflict do nothing;
    get diagnostics imported_count = row_count; rejected_import := imported_count = 0;
  end if;
  if not rejected_import then
    if p_patch ? 'session' then current_lesson := nullif(p_patch->'session', 'null'::jsonb);
    elsif p_patch ? 'session_step' then
      if current_lesson is null or current_lesson->>'id' is distinct from p_patch->'session_step'->>'id'
        or (current_lesson->>'cursor')::integer + 1 is distinct from (p_patch->'session_step'->>'cursor')::integer
        or current_lesson->'ids'->((current_lesson->>'cursor')::integer) is distinct from p_patch->'session_step'->'last'->'wordId' then
        raise exception 'Lesson step does not match the active question' using errcode = '22023';
      end if;
      current_lesson := current_lesson || ((p_patch->'session_step') - 'id'::text);
      if current_lesson->'last'->>'correct' = 'false' then current_lesson := jsonb_set(current_lesson, '{wrongIds}', (current_lesson->'wrongIds') || jsonb_build_array(current_lesson->'last'->'wordId')); end if;
    end if;
    if p_patch ? 'progress' then
      insert into public.lexical_word_progress (user_id, word_id, state)
        select owner_id, x.word_id, x.state from jsonb_to_recordset(p_patch->'progress') as x(word_id text, method text, state jsonb)
      on conflict (user_id, word_id) do update set state = excluded.state;
    end if;
    if p_patch ? 'days' then
      insert into public.lexical_days (user_id, day, answers) select owner_id, key::date, value::bigint from jsonb_each_text(p_patch->'days')
      on conflict (user_id, day) do update set answers = excluded.answers;
    end if;
    if p_patch ? 'tags' then
      delete from public.lexical_tags t using jsonb_each_text(p_patch->'tags') x where t.user_id = owner_id and t.word_id = x.key and x.value = 'false';
      insert into public.lexical_tags (user_id, word_id) select owner_id, key from jsonb_each_text(p_patch->'tags') where value = 'true' on conflict do nothing;
    end if;
    if p_patch <> '{}'::jsonb then
      update public.lexical_profiles set revision = revision + 1,
        settings = case when p_patch ? 'settings' then p_patch->'settings' else settings end, lesson = current_lesson
        where user_id = owner_id returning revision into current_revision;
    end if;
  end if;
  insert into public.lexical_clients(user_id, client_id, last_sequence) values (owner_id, p_client, p_sequence)
    on conflict (user_id, client_id) do update set last_sequence = excluded.last_sequence;
  return jsonb_build_object('status', case when rejected_import then 'duplicate_import' else 'applied' end, 'revision', current_revision);
end;
$$;

commit;
