-- Encher o blender não é uma avaria.
--
-- Às 14:21:01 de 10/08 a Filler Line 4 entrou em "Filling Blender/ Blending" e um
-- segundo depois o poll abriu a WO-826 — uma ordem de manutenção, prioridade alta,
-- com cinco minutos de paragem lançados contra ela. Ninguém avariou nada: a equipa
-- estava a encher o blender.
--
-- A causa está em duas tabelas que dizem coisas opostas sobre o mesmo código:
--
--   intouch_stop_code_map.requires_wo = true     → "abre ordem de manutenção"
--   intouch_stop_code_catalog.planned = true     → "paragem planeada"
--   intouch_exclusion_map                        → "estes minutos não contam
--                                                   contra uma ordem"
--
-- O mesmo edfaf8fa-… manda abrir a ordem e, ao mesmo tempo, manda descontar os
-- minutos dessa ordem. Nem o poll nem o trigger liam o catálogo — os dois decidem
-- só por requires_wo — por isso bastava aquela coluna estar mal para a manutenção
-- receber trabalho que não é dela.
--
-- Duas coisas aqui:
--
--   1. Os códigos que o próprio iTouching classifica como planeados deixam de pedir
--      ordem. São três, e não é só o do blender: "Metal Detector Checks" (dois GUIDs)
--      abriria a mesma ordem na próxima verificação do detector.
--
--   2. O trigger passa a ler o catálogo, não só a flag. Quem amanhã ligar o interruptor
--      requires_wo numa paragem planeada, no ecrã de admin, volta a criar a mesma
--      contradição — e a ordem é recusada e registada em audit_logs em vez de aparecer
--      no quadro da manutenção.

-- 1 ─ O dado. Uma paragem planeada não pede ordem de manutenção.
UPDATE public.intouch_stop_code_map m
SET requires_wo = false
WHERE m.requires_wo
  AND EXISTS (
    SELECT 1 FROM public.intouch_stop_code_catalog c
    WHERE lower(btrim(c.name)) = lower(btrim(m.label))
      AND c.planned
  );

-- 2 ─ A regra. O catálogo do iTouching decide antes da flag.
CREATE OR REPLACE FUNCTION public.enforce_intouch_wo_requires_maintenance_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  _requires boolean;
  _code text := btrim(coalesce(new.intouch_downtime_code, ''));
  _label text;
  _planned boolean;
  _activity text;
begin
  -- Manual orders are untouched: this only governs what iTouching may open.
  if _code = '' then
    return new;
  end if;

  select m.requires_wo, m.label into _requires, _label
  from public.intouch_stop_code_map m
  where lower(m.stop_code) = lower(_code)
  limit 1;

  -- A paragem que o iTouching diz ser planeada, ou que já está classificada como
  -- tempo da equipa, nunca abre ordem — independentemente do requires_wo.
  -- `order by ... desc nulls last`: o catálogo tem nomes repetidos com code_id
  -- diferentes, e basta uma das linhas dizer planeada para o ser.
  select c.planned into _planned
  from public.intouch_stop_code_catalog c
  where lower(btrim(c.name)) = lower(btrim(coalesce(_label, '')))
  order by c.planned desc nulls last
  limit 1;

  select e.activity into _activity
  from public.intouch_exclusion_map e
  where e.active
    and lower(btrim(e.stop_code_name)) = lower(btrim(coalesce(_label, '')))
  limit 1;

  if _planned is true or _activity is not null then
    insert into public.audit_logs (user_id, user_name, action, entity_type, details)
    values (null, 'system', 'intouch_wo_blocked', 'work_order',
            jsonb_build_object(
              'reason', case when _activity is not null
                             then 'team activity (' || _activity || ')'
                             else 'planned stop code' end,
              'stop_code', _code, 'label', _label,
              'machine', new.machine, 'description', new.description));
    return null;
  end if;

  if _requires is not true then
    insert into public.audit_logs (user_id, user_name, action, entity_type, details)
    values (null, 'system', 'intouch_wo_blocked', 'work_order',
            jsonb_build_object(
              'reason', case when _requires is null then 'stop code not mapped' else 'requires_wo = false' end,
              'stop_code', _code, 'machine', new.machine, 'description', new.description));
    return null;
  end if;

  -- Rewrite the poller's raw notes into something an engineer can read. The
  -- poller writes "[Auto-created from iTouching poll] / Machine: X / Status: 7 /
  -- Downtime code: <GUID>" — the status number is meaningless on the floor and
  -- nobody can tell what a GUID refers to. The edge function was fixed to write
  -- this properly, but edge functions do not deploy with the front end, so this
  -- normalises the text no matter which version of the poller is running.
  if new.notes like '[Auto-created from iTouching poll]%' then
    new.notes := coalesce(_label, new.description, 'Stop') || ' detected automatically by iTouching.' || chr(10)
              || 'Machine: ' || coalesce(
                   nullif(btrim(split_part(split_part(new.notes, 'Machine: ', 2), chr(10), 1)), ''),
                   new.machine, '—')
              || chr(10)
              || 'Detected: ' || to_char(coalesce(new.created_at, now()) at time zone 'Europe/London', 'DD/MM/YYYY HH24:MI');
  end if;

  return new;
end
$function$;

COMMENT ON FUNCTION public.enforce_intouch_wo_requires_maintenance_code() IS
  'Só o iTouching é governado aqui. Uma paragem planeada no catálogo, ou classificada como tempo da equipa, nunca abre ordem de manutenção — mesmo com requires_wo ligado. A recusa fica em audit_logs como intouch_wo_blocked.';
