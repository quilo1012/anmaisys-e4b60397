#!/usr/bin/env python3
"""
Casa os nomes de uma aba da planilha do headcount com a tabela `employees`.

Não grava nada e não decide nada: classifica cada nome da folha e devolve o
resultado, para quem chama reportar antes de tocar na base.

Uso:
    python match_names.py --folha folha.json --roster roster.json [--json]

folha.json   {"Line 1": ["Guilherme", "Vagner"], "Absence": ["Gabriela"], ...}
roster.json  [{"full_name": "Guilherme Machado", "employee_ref": "E057"}, ...]
             (o roster sai de: select full_name, employee_ref from employees where active)

Saída: quatro baldes.
  unico      — um só candidato. É o que se pode gravar.
  ambiguo    — mais de um candidato. Fica de fora; a pessoa errada numa linha
               é pior do que uma lacuna.
  parecido   — nenhum candidato pelas regras, mas há nomes semelhantes. Quase
               sempre grafia da folha ("Ezequiel" vs "Ezaquiel"). Sugestão para
               um humano confirmar, nunca uma correspondência.
  sem_registo— não existe ninguém parecido. A folha tem gente que o sistema não tem.

E ainda `conflitos`: o mesmo nome em duas colunas (alguém não pode estar numa
linha e de férias no mesmo dia).
"""

import argparse
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher


def norm(s: str) -> str:
    """Sem acentos, sem maiúsculas, sem espaços a mais — a folha mistura os três."""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s.lower().strip())


def candidatos(token: str, roster: list[dict]) -> list[dict]:
    """
    Candidatos para um nome da folha, por ordem de especificidade.

    Só o melhor nível encontrado conta: se houver uma correspondência exata, um
    match por primeiro nome não a torna ambígua. É o que evita que "Lucas Leonel"
    fique ambíguo só porque existem outros quatro Lucas.
    """
    alvo = norm(token)
    partes = alvo.split()
    achados: list[tuple[int, dict]] = []

    for pessoa in roster:
        completo = norm(pessoa["full_name"])
        palavras = completo.split()
        if not palavras:
            continue

        if completo == alvo:                                   # "Lucas Leonel"
            achados.append((0, pessoa))
        elif len(partes) > 1:
            # "Luis F" / "Lucas C" — primeiro nome mais uma inicial
            inicial = (
                palavras[0] == partes[0]
                and len(partes[1]) == 1
                and len(palavras) > 1
                and palavras[1].startswith(partes[1])
            )
            if inicial or completo.startswith(alvo):
                achados.append((1, pessoa))
            elif all(p in palavras for p in partes):           # "Rafael Franco"
                achados.append((2, pessoa))
        elif palavras[0] == alvo:                              # "Vagner"
            achados.append((3, pessoa))

    if not achados:
        return []
    melhor = min(nivel for nivel, _ in achados)
    return [p for nivel, p in achados if nivel == melhor]


def parecidos(token: str, roster: list[dict], corte: float = 0.85) -> list[str]:
    """
    Nomes graficamente próximos, para sugerir sem afirmar.

    O corte é deliberadamente apertado. Com 0.82 apareciam "Wilton → Ailton" e
    "Andreia → Andre", e uma lista de sugestões cheia de ruído é uma lista que
    ninguém lê — pior do que uma lista curta que falha uma.
    """
    alvo = norm(token)
    fora = []
    for pessoa in roster:
        primeiro = norm(pessoa["full_name"]).split()[0]
        if SequenceMatcher(None, alvo, primeiro).ratio() >= corte:
            fora.append(pessoa["full_name"])
    return sorted(fora)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--folha", required=True)
    ap.add_argument("--roster", required=True)
    ap.add_argument("--json", action="store_true", help="saída em JSON em vez de texto")
    args = ap.parse_args()

    folha = json.load(open(args.folha))
    roster = json.load(open(args.roster))

    res = {"unico": [], "ambiguo": [], "parecido": [], "sem_registo": [], "conflitos": []}
    onde: dict[str, list[str]] = {}

    # "Overtime staff" não é um sítio: quem lá está também está numa linha, e é
    # suposto. Contar essa repetição como conflito excluía precisamente as pessoas
    # que a folha quer destacar.
    NAO_E_LUGAR = {"overtime", "overtime staff"}

    for area, nomes in folha.items():
        for nome in nomes:
            if norm(area) not in NAO_E_LUGAR:
                onde.setdefault(norm(nome), []).append(area)
            cands = candidatos(nome, roster)
            if len(cands) == 1:
                res["unico"].append({"area": area, "folha": nome, "sistema": cands[0]["full_name"]})
            elif cands:
                res["ambiguo"].append({"area": area, "folha": nome,
                                       "candidatos": [c["full_name"] for c in cands]})
            else:
                perto = parecidos(nome, roster)
                balde = "parecido" if perto else "sem_registo"
                item = {"area": area, "folha": nome}
                if perto:
                    item["talvez"] = perto
                res[balde].append(item)

    for nome, areas in onde.items():
        if len(areas) > 1:
            res["conflitos"].append({"folha": nome, "areas": areas})

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    total = sum(len(v) for v in folha.values())
    print(f"NOMES NA FOLHA  {total}")
    for balde in ("unico", "ambiguo", "parecido", "sem_registo"):
        print(f"{balde.upper():<12} {len(res[balde])}")

    if res["conflitos"]:
        print("\n--- MESMO NOME EM DUAS COLUNAS (deixar de fora) ---")
        for c in res["conflitos"]:
            print(f"  {c['folha']}: {', '.join(c['areas'])}")
    for titulo, balde, campo in (
        ("AMBIGUOS (deixar de fora)", "ambiguo", "candidatos"),
        ("PARECIDOS (confirmar com humano)", "parecido", "talvez"),
    ):
        if res[balde]:
            print(f"\n--- {titulo} ---")
            for x in res[balde]:
                print(f"  {x['area']:<16} {x['folha']:<18} -> {', '.join(x[campo])}")
    if res["sem_registo"]:
        print("\n--- SEM REGISTO NO SISTEMA ---")
        for x in res["sem_registo"]:
            print(f"  {x['area']:<16} {x['folha']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
