-- A espera do armazém abre a sua própria ordem.
--
-- "Warehouse/Awaiting Packaging" é a linha parada à espera de embalagem. O tempo
-- já era medido — o código tem `requires_wo = false`, por isso o poll manda-o
-- para `production_downtimes` e os minutos entram no OEE — mas ninguém do
-- armazém tem razão nenhuma para abrir essa tabela, e por isso ninguém do
-- armazém sabia que a linha estava à espera dele. Nos 30 dias até 07/09 foram 2
-- a 5 esperas por dia, média entre 5 e 28 minutos, máximo 67. Tudo medido, tudo
-- invisível para quem podia encurtá-lo.
--
-- Cinco coisas aqui. As três primeiras fazem a ordem existir; as duas últimas
-- impedem-na de estragar dois números que não lhe dizem respeito — a saúde da
-- máquina e a data da última manutenção.

-- 1 ─ A coluna. Qual é a paragem que chama o armazém.
--
-- Coluna nova, e não um `wo_target` a substituir o `requires_wo`: aquela coluna
-- é lida pelo poll, por este trigger e por meia dúzia de queries que decidem o
-- que é downtime de produção. Trocar-lhe a semântica partia todas ao mesmo
-- tempo. Isto só acrescenta, e quem não souber dela continua a ler o mesmo.
ALTER TABLE public.intouch_stop_code_map
  ADD COLUMN IF NOT EXISTS raises_warehouse_wo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.intouch_stop_code_map.raises_warehouse_wo IS
  'Esta paragem abre uma ordem de armazém (wo_type = warehouse_service) enquanto durar, para o armazém ver o tempo que a linha está à espera dele. Independente de requires_wo: uma paragem pode chamar o armazém sem nunca chamar a manutenção, que é o caso de Warehouse/Awaiting Packaging.';

-- 2 ─ O dado. Hoje é uma paragem só.
--
-- Pelo GUID e pelo nome: o GUID é o que o iTouching manda, e o nome é o que
-- sobrevive a uma reinstalação que troque os GUIDs. Nenhum dos dois sozinho
-- chega, e ligar a mesma linha duas vezes não custa nada.
UPDATE public.intouch_stop_code_map
SET raises_warehouse_wo = true
WHERE lower(stop_code) = '5dd6a44d-9f0a-4c00-8ccb-f65691a5bc5d'
   OR lower(btrim(label)) = 'warehouse/awaiting packaging';

-- 3 ─ A regra que recusava a ordem antes de ela existir.
--
-- `enforce_intouch_wo_requires_maintenance_code` devolve NULL — a linha
-- desaparece em silêncio e fica um `intouch_wo_blocked` em `audit_logs` — para
-- qualquer ordem com um código do iTouching cujo `requires_wo` não seja true.
-- Foi escrita para uma pergunta só, "a manutenção deve ser chamada a isto?", e
-- respondia-a bem. Só que passou a ser a resposta a uma pergunta que ninguém lhe
-- fez: uma ordem de ARMAZÉM traz o mesmo código e leva a mesma recusa. Sem esta
-- alteração o poll insere, o Postgres cala, e o ecrã do armazém fica vazio sem
-- um único erro em lado nenhum.
--
-- A excepção é estreita de propósito: `wo_type = 'warehouse_service'`, que é um
-- tipo que por desenho nunca abre `downtime_events` nem conta como avaria (ver
-- `20260731120000_preventive_work_orders.sql`). Tudo o resto — a paragem
-- planeada, o tempo de equipa, o `requires_wo` — continua a ser julgado como
-- era, porque tudo isso é sobre chamar a manutenção, e isto não chama ninguém da
-- manutenção.
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

  -- Uma ordem de armazém não é uma ordem de manutenção, e é só sobre ordens de
  -- manutenção que esta função sabe alguma coisa. Quem decide se uma paragem
  -- chama o armazém é `intouch_stop_code_map.raises_warehouse_wo`, e o poll é o
  -- único que escreve estas linhas.
  if coalesce(new.wo_type, 'production') = 'warehouse_service' then
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
  'Só as ordens de MANUTENÇÃO do iTouching são governadas aqui. Uma paragem planeada no catálogo, ou classificada como tempo da equipa, nunca abre ordem — mesmo com requires_wo ligado. A recusa fica em audit_logs como intouch_wo_blocked. As ordens de armazém (wo_type = warehouse_service) passam sem julgamento: quem as decide é intouch_stop_code_map.raises_warehouse_wo.';

-- 4 ─ A saúde da máquina não pode descer por o armazém se atrasar.
--
-- `recalculate_health_scores` conta TODAS as ordens da máquina nos últimos 30
-- dias e tira 5 pontos por cada uma. Não olha ao `wo_type`. Com 2 a 5 esperas de
-- armazém por dia, cada máquina de enchimento juntaria entre 60 e 150 ordens em
-- 30 dias e a conta `100 - 5*n` punha-a em ZERO — não por avariar, mas por ter
-- esperado por embalagem. A média das 28 máquinas é 66 hoje.
--
-- O erro já existia em pequeno: as ordens de armazém abertas à mão no
-- `/dashboard/warehouse` e as preventivas sempre contaram como avarias aqui. A
-- app já não as conta — `NON_FAILURE_TYPES` em `src/lib/pmIntelligence.ts` e o
-- filtro em `ReliabilityDashboard.tsx` excluem as duas — por isso o número no
-- ecrã e o número na coluna diziam coisas diferentes sobre a mesma máquina.
-- Alinha-se a base com a regra que a app já aplica.
CREATE OR REPLACE FUNCTION public.recalculate_health_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _machine_name text;
  _wo_count integer;
  _long_repair_count integer;
  _recurrent_count integer;
  _score integer;
BEGIN
  _machine_name := COALESCE(NEW.machine, OLD.machine);

  -- Count WOs in last 30 days. Só as correctivas: uma preventiva é trabalho
  -- planeado e uma de armazém nunca tocou na máquina.
  SELECT COUNT(*) INTO _wo_count
  FROM work_orders
  WHERE machine = _machine_name
    AND COALESCE(wo_type, 'production') = 'production'
    AND created_at >= now() - interval '30 days';

  -- Count WOs with repair > 120 min in last 30 days
  SELECT COUNT(*) INTO _long_repair_count
  FROM work_orders
  WHERE machine = _machine_name
    AND COALESCE(wo_type, 'production') = 'production'
    AND created_at >= now() - interval '30 days'
    AND started_at IS NOT NULL
    AND finished_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (finished_at - started_at)) / 60 > 120;

  -- Count recurrent problems (same problem >= 3 times in 30 days)
  SELECT COUNT(*) INTO _recurrent_count
  FROM (
    SELECT description, COUNT(*) as cnt
    FROM work_orders
    WHERE machine = _machine_name
      AND COALESCE(wo_type, 'production') = 'production'
      AND created_at >= now() - interval '30 days'
    GROUP BY description
    HAVING COUNT(*) >= 3
  ) sub;

  -- Calculate score: 100 - 5*wo_count - 10*long_repairs - 15*recurrent
  _score := GREATEST(0, 100 - (_wo_count * 5) - (_long_repair_count * 10) - (_recurrent_count * 15));

  -- Update machine health score
  UPDATE machines SET health_score = _score WHERE name = _machine_name;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.recalculate_health_scores() IS
  'Saúde da máquina a partir das ordens CORRECTIVAS dos últimos 30 dias. Preventivas e ordens de armazém não entram — a mesma regra que src/lib/pmIntelligence.ts aplica no ecrã.';

-- 5 ─ Esperar por embalagem não é uma manutenção feita.
--
-- `sync_machine_status_from_wo` corre ao fechar qualquer ordem e, se não houver
-- outra aberta na máquina, põe `machines.status = 'active'` e carimba
-- `last_maintenance_date = now()`. Numa ordem de armazém isso são duas mentiras
-- pequenas e diárias: ninguém fez manutenção nenhuma, e uma máquina que estava
-- em 'maintenance' por outra razão voltaria a 'active' porque o armazém trouxe
-- as caixas.
CREATE OR REPLACE FUNCTION public.sync_machine_status_from_wo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _open_wo_count integer;
BEGIN
  -- Only act on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Uma ordem de armazém não diz nada sobre o estado da máquina.
  IF COALESCE(NEW.wo_type, 'production') = 'warehouse_service' THEN
    RETURN NEW;
  END IF;

  -- When WO becomes open or in_progress, set machine to maintenance
  IF NEW.status IN ('open', 'in_progress') THEN
    UPDATE machines SET status = 'maintenance' WHERE name = NEW.machine;
  END IF;

  -- When WO is closed or finished, check if there are other active WOs for this machine
  IF NEW.status IN ('closed', 'finished', 'completed', 'force_closed') THEN
    SELECT COUNT(*) INTO _open_wo_count
    FROM work_orders
    WHERE machine = NEW.machine
      AND id != NEW.id
      AND COALESCE(wo_type, 'production') <> 'warehouse_service'
      AND status NOT IN ('closed', 'finished', 'completed', 'force_closed');

    IF _open_wo_count = 0 THEN
      UPDATE machines
      SET status = 'active',
          last_maintenance_date = now()
      WHERE name = NEW.machine;
    ELSE
      -- Still has open WOs, just update last_maintenance_date
      UPDATE machines
      SET last_maintenance_date = now()
      WHERE name = NEW.machine;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_machine_status_from_wo() IS
  'Estado da máquina a partir das ordens que lhe tocam. As ordens de armazém (warehouse_service) não entram, nem para mudar o estado nem para o contar: esperar por embalagem não é manutenção feita.';
