-- Verificação do BLOCO 158. Só lê. Esperado: a primeira linha 'ok'; a segunda é informação.

select '158 coluna allergens em sku_products' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'sku_products'
                            and column_name = 'allergens' and data_type = 'ARRAY')
            then 'ok' else 'FALTA' end as result
union all
select '158 produtos com alergénios confirmados (informação)',
       (select count(*)::text from public.sku_products where allergens is not null);
