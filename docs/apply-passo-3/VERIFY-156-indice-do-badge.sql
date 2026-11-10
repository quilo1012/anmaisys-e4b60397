-- Verificação do BLOCO 156. Só lê. Esperado: 'ok'.
select '156 índice do badge existe' as check,
       case when to_regclass('public.system_telemetry_logs_type_created_idx') is not null
            then 'ok' else 'FALTA' end as result;
