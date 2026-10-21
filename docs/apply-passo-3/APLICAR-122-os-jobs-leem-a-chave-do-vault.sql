-- ================================================================
-- BLOCO 122
-- 20261021250000_cron_jobs_read_the_key_from_the_vault.sql
-- ================================================================
--
-- PT: Dois jobs do agendador (intouch-poll, todos os minutos, e calculate-shift-targets, de
-- meia em meia hora) tinham a chave do cron escrita em texto no proprio comando. Qualquer
-- pessoa que leia `cron.job` a ve, e a mesma chave esta numa migracao antiga do repositorio
-- (20260807140000). Os outros jobs (safetyculture-sync, intouch-sync-production e o gatilho do
-- push) ja a leem do vault. Aqui os dois passam a ler do vault tambem, com o MESMO valor, por
-- isso nada muda para quem os recebe: e o passo que torna possivel TROCAR a chave depois, num
-- so sitio, sem editar jobs.
--
--   * Procura em todos os jobs o padrao 'x-cron-secret', '<hex>' e troca o valor literal por
--     (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET').
--   * Se o vault nao tiver CRON_SECRET, nao toca em nada: um job a ler um vault vazio
--     mandaria um cabecalho vazio e pararia.
--   * Idempotente: sem nenhum literal, nao faz nada. Nao troca a chave, nao muda horarios.
--
-- EN: Two scheduler jobs (intouch-poll every minute, calculate-shift-targets every half hour)
-- carried the cron key as plain text in their command. Anybody who can read `cron.job` sees it,
-- and the same key sits in an old migration (20260807140000). The other jobs already read it
-- from the vault. This makes these two read it from the vault too, with the SAME value, so
-- nothing changes for the receiver; it is the step that lets the key be rotated in one place.
-- It leaves everything alone when the vault has no CRON_SECRET, and does nothing when no
-- literal is left. It does not rotate the key and does not change any schedule.

do $$
declare
  j record;
  v_new text;
  c_old constant text := $re$'x-cron-secret'\s*,\s*'[0-9a-fA-F]{32,}'$re$;
  c_new constant text := $nw$'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)$nw$;
begin
  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'pg_cron or the vault is not here; nothing to do';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'CRON_SECRET' and coalesce(decrypted_secret, '') <> '') then
    raise notice 'The vault has no CRON_SECRET; leaving the jobs as they are';
    return;
  end if;

  for j in select jobid, command from cron.job where command ~ c_old loop
    v_new := regexp_replace(j.command, c_old, c_new, 'g');
    if v_new = j.command or v_new ~ c_old then
      raise exception 'cron job % was not rewritten cleanly', j.jobid;
    end if;
    perform cron.alter_job(j.jobid, command := v_new);
    raise notice 'cron job % now reads the key from the vault', j.jobid;
  end loop;
end;
$$;
