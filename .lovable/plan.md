## Padronização de nomes de Linha

### Contexto
O dropdown **Line** no Edit Machine puxa da tabela `lines`, que ainda mantém o prefixo `"Filler "` em 6 registros. O campo legado `machines.line` (texto) e o histórico `work_orders.line_at_time` também guardam o nome antigo.

### Estado atual confirmado
- `lines`: 6 registros com prefixo "Filler " (Filler Line 1 → Filler Line 6)
- `machines.line`: 8 máquinas com valor "Filler Line X"
- `work_orders.line_at_time`: contém valores antigos a serem reescritos

### Mudanças (1 migration de UPDATE)

**1. Tabela `lines`** — remover prefixo "Filler " do `name`:
```sql
UPDATE public.lines
SET name = regexp_replace(name, '^Filler\s+', '')
WHERE name ILIKE 'Filler %';
```
Resultado: `Filler Line 1` → `Line 1`, …, `Filler Line 6` → `Line 6`.
**Não toca em** `Blender Line X` nem em `Capsules & Tablets`, `Gel Line`, `Sealer and Printer INK`.

**2. Tabela `machines`** — limpar campo legado `line`:
```sql
UPDATE public.machines
SET line = regexp_replace(line, '^Filler\s+', '')
WHERE line ILIKE 'Filler %';
```

**3. Tabela `work_orders`** — atualizar histórico `line_at_time`:
```sql
UPDATE public.work_orders
SET line_at_time = regexp_replace(line_at_time, '^Filler\s+', '')
WHERE line_at_time ILIKE 'Filler %';
```

### Não será alterado
- Código frontend (o dropdown lê `lines.name` dinamicamente — vai refletir automaticamente).
- Tabela `Blender Line X` (ficará como está).
- `machine_type` (categoria "Filler" continua válida como tipo de máquina).

### Verificação pós-migração
Conferir no Edit Machine que o dropdown Line agora mostra "Line 1" … "Line 6".