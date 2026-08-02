# Colunas da planilha → áreas do sistema

As áreas vivem em `headcount_areas` (só `active = true`). Os nomes não coincidem todos
com os da folha, e três colunas não são áreas de todo.

## Produção

| Coluna da folha | Área em `headcount_areas` | Nota |
|---|---|---|
| Line 1 … Line 4 | `Line 1` … `Line 4` | direto |
| Line 5 (A&B) | `Line 5` | o "(A&B)" é rótulo da folha, não é outra linha |
| Line 6 (A&B) | `Line 6` | idem |
| Pill line | `Capsules Machine 1` **ou** `Capsules Machine 2` | a folha tem uma coluna, o sistema tem duas máquinas. Se a folha não distinguir, põe em `Capsules Machine 1` e diz que o fizeste |
| Tablet line | `Tablet Line` | direto |
| Hygiene | `Hygiene` | no sistema é `kind = support`, na folha está na faixa de produção. Não é problema — o total "in Production" da folha soma as duas faixas |
| Quality | `Quality` | idem |
| Gel Room | `Gel Room` | cuidado: existe também `GEL Line`, que é de produção e é outra coisa |
| Runner | `Runner` | |

## Apoio

| Coluna da folha | Área em `headcount_areas` |
|---|---|
| Lab | `Lab` |
| Assembly | `Assembly` |
| WH team | `WH Team` |
| Office | `Office` |
| Maintenance | `Maintenance` |
| Blender Team | `Blender Team` |

## As três colunas que não são áreas

| Coluna | O que fazer |
|---|---|
| **Absence** | `status = 'absence'`, `area_id = null` |
| **Holidays** | `status = 'holiday'`, `area_id = null`. Se a folha anotar "(unpaid)" ao lado do nome, isso é informação de payroll que `daily_allocations` não guarda — menciona-o no relatório |
| **Overtime staff** | **Não alocar.** Estas pessoas já estão numa linha noutra coluna; esta coluna diz que o dia delas é de horas extra, não onde estão. O sistema deriva isso da escala. Se alguém desta coluna não aparecer em nenhuma linha, reporta — é uma incoerência da folha |

## Verificação cruzada

A folha tem uma célula **"Total staff in Production"** (numa aba real: 77). Deve bater
com a soma das duas faixas de colunas — produção mais apoio, sem Absence, Holidays nem
Overtime. Usa-a como conferência da tua transcrição: se não bater, transcreveste mal ou
os totais da folha estão desatualizados. Diz qual dos dois, não emendes em silêncio.

## Áreas do sistema que a folha não tem

`Capsules Machine 2` e `GEL Line` existem em `headcount_areas` mas não têm coluna
própria na folha. Ficam vazias — é o estado verdadeiro, não uma falha.
