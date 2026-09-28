# Laya local (Unsloth Studio) no lugar do Jev (2026-09-28)

## Contexto

O Unsloth Studio v0.1.900-beta passou a servir o Laya, um modelo de decisão não generativo
(sim/não, múltipla escolha, nota, com probabilidades), num endpoint `/v1/systemone` compatível com
o Jev. O `decide` e os dois modos shadow (`POLYAGENT_JEV_FANOUT`, `POLYAGENT_JEV_SHADOW`) pagam o
Jev no OpenRouter. A pergunta: apontar `POLYAGENT_JEV_URL` para o Laya local troca o Jev sem
perder qualidade?

Nenhuma mudança de código foi necessária: `src/jev.ts` já lê `POLYAGENT_JEV_URL` e
`POLYAGENT_JEV_MODEL`, e o Studio aceita a chave de API dele como `Authorization: Bearer`.

## Método

Mesmo `bench/jev-bench.mjs` e mesmas fixtures do [estudo do Jev](2026-09-24-jev-decisions-bench.md),
3 repetições de todas as suítes (183 chamadas por modelo), rodado em 2026-09-28 no notebook do
usuário (AMD gfx90c integrada, 17 GB de RAM), Studio em `127.0.0.1:8888`:

```bash
OPENROUTER_API_KEY="$(cat ~/.config/unsloth-studio.key)" \
POLYAGENT_JEV_URL=http://127.0.0.1:8888/v1/systemone \
POLYAGENT_JEV_MODEL=<checkpoint> node bench/jev-bench.mjs 3 all
```

Ids aceitos pelo Studio (`core/systemone/catalog.py`): `laya-multilingual` (mmBERT-base, 678 MB),
`laya-english` e `laya-typed-decisions` (ModernBERT-large, 846 MB), mais os apelidos `laya`,
`default`, `jev-latest` que resolvem para o checkpoint configurado na UI. O nome do repo HF
(`convaiinnovations/laya`) é recusado com `Unknown model`. Checkpoint fora do default carrega sob
demanda na primeira chamada (503 `model_loading` até terminar).

Bruto: [`laya-multilingual`](bench/2026-09-28-laya-multilingual-bench.jsonl) (via apelido `laya`) e
[`laya-typed-decisions`](bench/2026-09-28-laya-typed-decisions-bench.jsonl).

## Resultados

| Métrica | Jev 1.13 (2026-09-25) | laya-multilingual | laya-typed-decisions |
|---|---|---|---|
| `fan_out` curto, t=0,85: acurácia | 100% | 66,7% | 50,0% |
| `fan_out` curto, t=0,85: skip rate | 50% | 16,7% | 0% |
| `fan_out` curto, t=0,85: false skips | 0/36 | 0/36 | 0/36 |
| `fan_out` curto, t=0,50: false skips | 0/36 | 12/36 | 9/36 |
| `fan_out` longo: chamadas válidas | 36/36 | 0/36 | 0/36 |
| shadow: exato / dentro da faixa | 96% / 100% | 20% / 32% | 40% / 56% |
| mediana `fan_out` curto | 465 ms | 390 ms | 1014 ms |
| custo | ~US$ 0,0064 no estudo | 0 | 0 |

- **`fan_out` longo:** todas as chamadas voltam 422 `State and questions exceed the Laya context
  window` (1024 tokens no multilingual e no typed-decisions). O gate cai no árbitro, então é seguro,
  mas não economiza nada.
- **`fan_out` curto:** no threshold default 0,85 nenhum dos dois pula o árbitro por engano, mas
  pulam pouco (multilingual) ou nunca (typed-decisions). Baixar o threshold para ganhar skips traz
  false skips, inclusive nos near-miss `hard`.
- **shadow:** o multilingual joga quase tudo em 1–2; o typed-decisions concentra em 3 e manda
  todo nível 5 para 3.

## Decisão

Não trocar o Jev pelo Laya. Nenhuma mudança de default ou de código. Com threshold 0,85 o Laya é
seguro como gate de `fan_out` (erro e baixa confiança caem no árbitro), mas a economia é pequena ou
nula, e o shadow de nível fica inutilizável.

## Limites

- Mesmas fixtures sintéticas do estudo do Jev; nenhuma saída real de `fan_out`.
- O dispositivo (CPU ou GPU) veio da UI do Studio e não foi conferido; a latência pode mudar.
- `laya-english` (512 tokens de contexto) não foi medido.
- O prompt das perguntas foi escrito para o Jev; não houve ajuste para o Laya.

## Fontes

- [Unsloth v0.1.900-beta release notes](https://github.com/unslothai/unsloth/releases/tag/v0.1.900-beta)
- [Anúncio do Unsloth no X](https://x.com/UnslothAI/status/2104592692072304916)
- [Guia do Laya no Unsloth](https://unsloth.ai/docs/models/decision-laya)
- [Laya upstream](https://github.com/haddock-development/laya_new)

## Reavaliar

Quando sair um checkpoint Laya com janela bem maior que 1024 tokens (o `fan_out` longo tem 7–12K
caracteres) ou um fine-tune para concordância entre respostas. Repetir o mesmo comando acima e
comparar com esta tabela.
