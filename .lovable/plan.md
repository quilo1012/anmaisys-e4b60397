# Plano: corrigir FK de quality_actions.leader_id

## Objectivo
Aplicar a migração `20160825090000_a_line_leader_is_not_an_account.sql` exactamente como foi fornecida, sem alterações, e sem aplicar outras migrações pendentes. Depois confirmar para onde aponta a foreign key de `quality_actions.leader_id`.

## Passos

1. Criar o ficheiro `supabase/migrations/20160825090000_a_line_leader_is_not_an_account.sql` com o conteúdo fornecido.
2. Aplicar apenas essa migração à base de dados (não aplicar outras pendentes).
3. Executar a consulta de verificação:
   ```sql
   SELECT confrelid::regclass AS aponta_para
   FROM pg_constraint
   WHERE conrelid = 'public.quality_actions'::regclass AND contype = 'f'
     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
         WHERE attrelid='public.quality_actions'::regclass AND attname='leader_id')];
   ```
4. Reportar o resultado ao utilizador.

## Notas técnicas
- A migração remove a FK existente para `auth.users(id)`, reconcilia `leader_id` com base em `leader_name` contra `public.line_leaders`, limpa ids órfãos, e recria a FK para `public.line_leaders(id)` com `ON DELETE RESTRICT`.
- Não serão feitas alterações a código frontend, hooks, tipos ou outras migrações.
