# Família LoRA de fine-tuning: SoRA, QLoRA, DoRA e primos (2026-09-28)

## Contexto

O estudo do [Laya local](2026-09-28-laya-local.md) passou pelo Unsloth, que é antes de tudo uma
ferramenta de fine-tuning. Daí veio a pergunta: o que é o SoRA, e o que as outras variantes de LoRA
mudam? Ainda não há decisão para o bridge. O material serve de base caso a frota venha a usar um
modelo afinado localmente (um decisor tipo Jev ou um worker pequeno).

## A ideia base: LoRA

Treinar de novo todos os pesos de um modelo é caro. Uma matriz 4096×4096 tem 16 milhões de
números. O LoRA congela o modelo e treina só a *mudança*, guardada como duas matrizes finas:
`A` (4096×r) e `B` (r×4096). O produto `B×A` volta a ter 4096×4096, mas com `r = 8` são cerca de
65 mil números, umas 250× menos. O `r` é o **rank**: maior deixa o remendo mais expressivo e mais
caro. A escala padrão do remendo é `alpha/r`.

## O que cada variante muda

| Peça do esquema | Variante | O que faz |
|---|---|---|
| Tamanho do rank | **SoRA** (Sparse LoRA, EMNLP 2023) | Começa com rank alto. Um gate entre `A` e `B` recebe penalidade L1 com gradiente proximal e zera entradas, então cada camada termina com o rank de que precisa. É o único da lista que aprende o rank (mesma família do AdaLoRA). |
| Memória do modelo base | **QLoRA** | LoRA sobre o modelo base quantizado em 4 bits NF4. O adapter é o mesmo. |
| Inicialização de `A` e `B` | **PiSSA** | Começa pelos vetores singulares principais do peso, e não por ruído. Converge mais rápido. |
| Learning rate de `A` e `B` | **LoRA+** | `B` aprende com learning rate maior que `A`. Só o otimizador muda. |
| Conta de escala | **rsLoRA** | Usa `alpha/sqrt(r)`, para ranks altos treinarem estáveis. |
| O que o remendo toca | **DoRA** | Separa o peso em magnitude e direção e aplica o LoRA só na direção. |
| Quantos parâmetros treinar | **VeRA** | Um par de matrizes aleatórias congeladas, compartilhado entre camadas. Treina só vetores de escala pequenos. |

## Suporte no Unsloth

Docs e changelog conferidos em 2026-09-28:

- **Tem:** LoRA, QLoRA (é o caminho principal), rsLoRA (`use_rslora=True`), DoRA (desde
  2026-07-29) e inicialização SVD estilo LoftQ.
- **Não tem:** SoRA. Não aparece em docs, changelog nem issues.
- **Talvez:** PiSSA (`init_lora_weights="pissa"`), LoRA+ (`create_loraplus_optimizer`) e VeRA
  (`VeraConfig`) existem no Hugging Face PEFT, que é a base do Unsloth. Não foi confirmado se
  funcionam com os kernels otimizados dele.

## Decisão

Nenhuma mudança no bridge. É só base de conhecimento.

## Limites

- Nenhuma variante foi medida aqui; a tabela resume os papers e a doc.
- Os ids arXiv das variantes que não são o SoRA foram citados pelo pesquisador de memória, sem abrir
  as páginas.
- A máquina de teste tem GPU integrada AMD (`gfx90c`); um treino real provavelmente cabe melhor na
  note2 ou na nuvem.

## Fontes

- SoRA: [arXiv 2311.11696](https://arxiv.org/abs/2311.11696),
  [ACL Anthology](https://aclanthology.org/2023.emnlp-main.252/),
  [código](https://github.com/TsinghuaC3I/SoRA)
- [Guia de hiperparâmetros LoRA do Unsloth](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide)
- [Changelog do Unsloth](https://unsloth.ai/docs/new/changelog)
- Outras variantes, de memória: LoRA 2106.09685, QLoRA 2305.14314, DoRA 2402.09353,
  rsLoRA 2312.03732, LoRA+ 2402.12354, VeRA 2310.11454, PiSSA 2404.02948.

## Reavaliar

Quando a frota precisar de um modelo afinado (por exemplo, um decisor local que substitua o Jev).
Antes de escolher uma variante, rodar um treino curto com e sem ela no mesmo dataset e comparar a
perda de validação. Conferir no changelog do Unsloth se SoRA ou PiSSA ficaram nativos.
