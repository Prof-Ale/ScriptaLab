# ✒️ ScriptaLab | LabTech

<p align="center">
  <img src="./logo-horizontal.svg" alt="ScriptaLab — Engenharia Textual Acadêmica | LabTech" width="520">
</p>

[![Status do Projeto](https://img.shields.io/badge/Status-MVP%20Fase%202%20Ativo-22c55e?style=for-the-badge)](https://prof-ale.github.io/ScriptaLab/)
[![Norma ABNT](https://img.shields.io/badge/ABNT-NBR%2010520%3A2023%20%7C%2014724%3A2024-38bdf8?style=for-the-badge)](https://prof-ale.github.io/ScriptaLab/)
[![Ecossistema](https://img.shields.io/badge/Ecossistema-MathLab%20Educa%C3%A7%C3%A3o-8b5cf6?style=for-the-badge)](https://prof-ale.github.io/MathLab/)
[![Arquitetura](https://img.shields.io/badge/Privacidade-100%25%20Client--Side-eab308?style=for-the-badge)](#-arquitetura-e-privacidade-zero-retention)

> **Higienização de artefatos de IA, estilometria acadêmica, auditoria de citações e DOIs, e normatização parametrizada (ABNT e manuais de IES).**
> Uma solução **LabTech** do ecossistema **[MathLab Educação](https://prof-ale.github.io/MathLab/)**.

🔗 **Acesse online:** https://prof-ale.github.io/ScriptaLab/

---

## 🎯 Sobre o projeto

O ScriptaLab roda inteiramente no navegador (*client-side first*, zero-build, com núcleo em módulos ES puros em `src/core/`). Ele **mede e sinaliza** problemas no texto e só altera algo quando a pessoa aceita cada item no painel de diff ou clica em *Autorizar e normatizar*. O princípio é o **Zero-Tampering**: vocabulário, argumentos e conclusões do autor não são reescritos.

Os indicadores de estilo e as buscas bibliográficas são **apoio à revisão**: não provam autoria nem uso de IA, e uma obra "não encontrada" não é prova de invenção.

---

## ⚙️ Módulos (estado real)

| Módulo | Estado | O que faz |
|---|---|---|
| 🧹 **Scrubber (`src/core/scrubber.js`)** | ✅ pronto | Remove `【4:0†source】` e `[oai_citation:…]`, parâmetros `?utm_*`, caracteres Unicode invisíveis (`U+200B–200D`, `U+2060`, `U+FEFF`, `U+202F`) e une palavras quebradas por hífen no fim da linha. |
| 🔀 **Diff & Desfazer (`src/core/diffEngine.js`)** | ✅ pronto | Revisão item a item (antes → depois) com aceitar/rejeitar individual, aceitar todas, pilha de desfazer e reset (Zero-Tampering). |
| 📊 **Estilometria + VoiceProfile (`src/core/stylometry.js`, `literaryReview.js`)** | ✅ pronto | Burstiness (CV = σ/μ × 100), radar de clichês PT-BR, estilometria profunda (tríades, listas `**Rótulo:**`, parágrafos gêmeos, aberturas repetidas, TTR/Guiraud), calibração de **Perfil de Voz Autoral (`VoiceProfile`)** na sessão e revisão literária cirúrgica com **trava de preservação conceitual** (citações, DOIs, fórmulas LaTeX e `[F#]`). |
| 🔍 **Auditor (`src/core/citationAuditor.js`)** | ✅ pronto | Citações no texto × lista de referências; DOIs na CrossRef (inclui checagem de agência para DataCite) e **comparação com a referência colada ao lado do DOI**; Autor+Ano na CrossRef, com OpenAlex opcional. |
| 📐 **Motor ABNT (`src/core/abnt10520.js`, `abnt6023.js`)** | ✅ pronto | **NBR 10520:2023:** `(SILVA, 2023)` → `(Silva, 2023)` preservando siglas, expressões latinas em itálico, uniformidade de *et al.* e alerta de ponto final. **NBR 6023:2025:** classificação de obras, auditoria de campos ausentes (sem inventar dados), duplicadas e ordenação alfabética A–Z opt-in com desfazer. |
| ✍️ **Revisor de português (`src/core/ptRevisor.js`, `rules/ptbr.json`, `spell.js`, `ptAiBridge.js`)** | ✅ pronto (v0.4.0) | **Regras como dados** (48): pontuação e espaçamento, crase, regência, concordância, vícios, pleonasmos e coloquialismos, cada uma com exemplo *ruim*/*bom* conferido por teste. Medidores: período longo, gerúndios encadeados, repetição próxima, passiva em série, mistura de pessoa, aspas e parênteses. **Registro** selecionável (acadêmico, didático, divulgação) muda severidade e limites. **Ortografia pt-BR offline** (dicionário VERO 3.2 em filtro de Bloom, 5,4 MB, carregado só quando você liga). Só as correções mecânicas seguras viram proposta no diff; o resto é sinal. Aspas, fórmulas, URLs, DOIs, citações e a seção REFERÊNCIAS nunca são revisados. Segunda opinião da IA por copiar-e-colar (`scriptalab.pt-suggestion/1`) passa pela mesma trava de preservação. |
| 🏛️ **Perfis de IES + DOCX NBR 14724** | ✅ pronto | JSON validado por schema em `templates-ies/`. Exportação `.docx` aplica margens, fonte, entrelinhas, recuo, citação longa, **numeração de páginas no cabeçalho**, legendas/notas em fonte menor (10pt) e referências alinhadas à esquerda em espaço simples. |
| 🔗 **Ponte MathLab App (`src/core/mathlabBridge.js`)** | ✅ pronto | Abre o arquivo `mathlab.scriptalab-source/1` do App, propõe limpeza e ajuste `(Autor, Ano)` por bloco, bloqueia correção que perderia número, fórmula, marcador `[F#]` ou citação, e exporta o pacote `scriptalab.review/1` só com o que o autor marcou. Não toca em fórmulas e nunca leva validação humana. O `beforeHash` é o SHA-256 do corpo em UTF-8 com quebras LF, igual ao do App. |

**Ainda fora de escopo / futuro:** remoção automática de `[1]`, normalização de travessões e integração Semantic Scholar.

### Como o Auditor funciona
- **Sem chave:** usa a CrossRef pública. O e-mail (opcional) entra como `mailto` e coloca a consulta no *polite pool*. Fila sequencial (150 ms por registro e 400 ms por busca com e-mail; 250 ms e 1,1 s sem e-mail), `Retry-After` respeitado e cache na sessão. Os limites vigentes da CrossRef são divulgados por ela e mudam; confira antes de aumentar a taxa.
- **OpenAlex:** exige chave gratuita desde fev/2026. É **opcional**: o usuário pode colar a própria chave (guardada só em `sessionStorage`). Sem chave, o auditor tenta a cota gratuita uma vez e, ao primeiro 401/403/409/429, desliga o OpenAlex em silêncio na sessão.
- **Limites a conhecer:** livros, capítulos, normas e documentos sem DOI são mal cobertos pela CrossRef; "nenhuma obra compatível" pede verificação manual.

---

## 🔒 Arquitetura e privacidade (Zero-Retention)

1. **O texto nunca é enviado.** Só saem do navegador DOIs e pares sobrenome+ano, para `api.crossref.org` (e `api.openalex.org`, se houver chave ou cota).
2. **CSP restritiva** (`<meta http-equiv="Content-Security-Policy">`): `connect-src` só aceita CrossRef, OpenAlex e o CDN do worker do PDF; sem imagens remotas, sem formulários.
3. **Bibliotecas com versão fixa e SRI (SHA-384):** `docx@8.5.0`, `mammoth@1.6.0`, `pdf.js@4.10.38` (módulos ES). O *worker* do pdf.js é baixado com `fetch(..., {integrity})` e executado a partir de um `Blob`, porque `workerSrc` não aceita SRI.
4. **pdf.js 4.10.38:** migração para a série 4.x concluída (corrige CVE-2024-4367), mantendo `isEvalSupported: false` como defesa em profundidade.
5. `sessionStorage` guarda apenas e-mail opcional, chave opcional, `VoiceProfile` calibrado e cache das respostas; some ao fechar a aba. Nada vai para `localStorage`.

---

## 📐 Regras ABNT aplicadas (com fonte)

| Regra | Norma | Fonte consultada |
|---|---|---|
| Sobrenome em citação parentética só com inicial maiúscula; caixa alta permanece nas referências | NBR 10520:2023 | [IFCE – Atualizações](https://portal.ifce.edu.br/documents/3352/ANEXO_-__Atualiza%C3%A7%C3%B5es_da_ABNT_NBR_10520-2023.pdf), [UniCesumar](https://rdu.unicesumar.edu.br/bitstream/123456789/9937/1/NBR%2010520%20-%20Atualiza%c3%a7%c3%b5es) |
| Siglas de instituições permanecem em maiúsculas | NBR 10520:2023 | material institucional (ver acima) |
| Itálico em *et al.*, *apud*, *ibid.*, *op. cit.*, *loc. cit.*, *passim*, *et seq.* e *cf.* (e *Id.* dentro de citação) | NBR 10520:2023 | Biblioteca FE/UNESP Ilha Solteira, *Por dentro da Biblioteca* nº 130, ago/2023 (PDF informativo fornecido pelo autor do projeto; sem link público conferido) |
| Ponto final encerra a frase, não a citação: `(Autor, 2020).` e não `(Autor, 2020.)` (só sinalizado) | NBR 10520:2023 | idem |
| 4 ou mais autores: citar o primeiro + *et al.* é permitido, e o método deve ser uniforme no documento | NBR 10520:2023 | idem |
| Margens 3/3/2/2 cm; entrelinhas 1,5; citação longa >3 linhas, sem aspas, fonte menor, espaço simples | NBR 14724:2024 | [UFRGS](https://www.ufrgs.br/bibbio/formatacao-de-trabalhos-academicos-no-word/) |
| Recuo de 4 cm na citação longa é recomendação, não imposição | NBR 10520:2023 | cada perfil de IES define o seu |

Edições vigentes consultadas em nov/2026: NBR 10520:**2023**, NBR 14724:**2024** (16/12/2024) e NBR 6023:**2025** (3ª edição, 21/05/2025). Documente a fonte de cada nova regra neste quadro.

---

## 🏛️ Perfis de IES

| Perfil | Status | Observação |
|---|---|---|
| `abnt-padrao-2023.json` | base | regra geral ABNT |
| `usp-abnt.json` | verificado (07/11/2026) | *Diretrizes ABCD/USP: Parte I (ABNT)*. A USP também possui partes específicas para APA, Vancouver e ISO |
| `unicamp-ccpg-abnt.json` | verificado (07/11/2026) | *IN CCPG nº 06/2025* (SBU/PRPG UNICAMP); aceita Times New Roman ou Arial (11 ou 12 pt) |
| `unesp-cgb-abnt.json` | verificado (07/11/2026) | *Manual de Normalização da Rede de Bibliotecas da UNESP (CGB)* |
| `ifsp-abnt.json` | verificado (07/11/2026) | *Normalização de Trabalhos Acadêmicos do IFSP* (padrão ABNT; templates por campus) |
| `ifsuldeminas-carmo-tcc-artigo.json` | verificado (07/11/2026) | **vale só para o curso de Administração, Campus Carmo de Minas**: o documento de origem restringe o uso a esse curso e campus |
| `anhanguera-uam.json` | em validação | valores ainda sem manual conferido |

Para adicionar novos perfis de instituições ou programas específicos (ex.: variantes APA/Vancouver da USP), consulte `templates-ies/CONTRIBUINDO.md`.

---

## 📁 Estrutura do repositório

```text
ScriptaLab/
├── index.html                 # Interface e controlador (<script type="module">, zero-build)
├── src/core/                  # Núcleo ESM puro (zero dependência; roda no navegador e em Node)
│   ├── index.js               # Barrel + ScriptaCore
│   ├── textUtils.js           # Utilitários de normalização, HTML escaping e parágrafos
│   ├── scrubber.js            # Higienização de artefatos de IA, Unicode invisível, UTM e hifens
│   ├── diffEngine.js          # Revisão item a item (antes/depois, aceitar/rejeitar e desfazer)
│   ├── stylometry.js          # Segmentação PT-BR, CV (σ/μ) e radar de clichês
│   ├── literaryReview.js      # Estilometria profunda, VoiceProfile e trava conceitual
│   ├── abnt10520.js           # Regras NBR 10520:2023 (citações, siglas, itálico, ponto final)
│   ├── abnt6023.js            # Auditoria e ordenação A–Z NBR 6023:2025 + legendas NBR 14724
│   ├── citationAuditor.js     # Cruzamento citação × referência, DOIs e comparação CrossRef
│   ├── mathlabBridge.js       # Ponte mathlab.scriptalab-source/1 ↔ scriptalab.review/1 (sha256)
│   ├── ptRevisor.js           # Revisão de português: regras (rules/ptbr.json), medidores, registros
│   ├── spell.js               # Ortografia offline: expansão Hunspell → filtro de Bloom + sugestões
│   ├── ptAiBridge.js          # Contrato scriptalab.pt-suggestion/1 (IA por copiar-e-colar)
│   └── rules/ptbr.json        # 48 regras de português + limites por registro (dados, não código)
├── docs/
│   └── ARQUITETURA_INTEGRADA_MATHLAB_SCRIPTALAB.md
├── manifest.webmanifest       # Manifesto PWA
├── favicon.svg / favicon-*.png / icon-*.png / icon-app.svg / logo-horizontal.svg / avatar.*
├── data/
│   ├── cliches-ptbr.json      # Lista editável do radar de clichês (espelha o padrão embutido)
│   └── ortografia/            # pt-br.bloom (VERO 3.2, ~5,4 MB), pt-br.meta.json e LICENCA-VERO.txt
├── templates-ies/
│   ├── schema.json            # JSON Schema dos perfis
│   ├── _modelo-vazio.json     # Ponto de partida para novos perfis
│   ├── abnt-padrao-2023.json
│   ├── usp-abnt.json
│   ├── unicamp-ccpg-abnt.json
│   ├── unesp-cgb-abnt.json
│   ├── ifsp-abnt.json
│   ├── ifsuldeminas-carmo-tcc-artigo.json
│   ├── anhanguera-uam.json
│   └── CONTRIBUINDO.md
├── tests/
│   ├── core.test.js           # 32 testes unitários do núcleo ESM (Node, sem dependências)
│   └── e2e/e2e_test.py        # 33 verificações no navegador (Playwright; APIs simuladas)
├── tools/
│   ├── validate-templates.js  # valida perfis contra o schema
│   ├── gerar-dicionario.mjs   # regenera data/ortografia/ a partir do pacote dictionary-pt (devDependency)
│   ├── gerar-dourado-pt.mjs   # regenera o corpus dourado de português
│   └── sri.sh                 # confere/recalcula os hashes SRI contra os CDNs
├── .github/workflows/ci.yml   # testes + schema + SRI a cada push
└── package.json
```

Desenvolvimento local: `npm install && npm run check`. Para servir a página (necessário para módulos ES e JSON): `python3 -m http.server`.

---

## 🗺️ Roteiro

- [x] Migrar para pdf.js 4.x (`4.10.38`, módulos ES) com verificação de integridade SHA-384
- [x] Perfis IFSP, USP, UNICAMP e UNESP a partir dos manuais oficiais (ABNT)
- [x] Campo `citationStyle` (ABNT, APA, Vancouver, ISO) no schema
- [x] Numeração de páginas, fonte menor em notas/legendas e referências alinhadas à esquerda no `.docx`
- [x] Ordenação alfabética opt-in e checagem estrutural das referências (NBR 6023:2025)
- [x] Diferença antes/depois e desfazer por item (`diffEngine.js` + `#diffPanel`)
- [x] Estilometria profunda, `VoiceProfile` autoral e trava de preservação conceitual
- [x] Ponte bidirecional com o MathLab App (`mathlab.scriptalab-source/1` ↔ `scriptalab.review/1`)
- [x] Revisor de português formal (v0.4.0): regras como dados, registros, ortografia offline e IA por copiar-e-colar
- [ ] Ampliar as regras de português com casos reais de teses (cada regra nova entra com exemplo ruim/bom e teste)
- [ ] Ortografia: lista de termos técnicos por área (importável) e dicionário do usuário persistente entre sessões


---

## ✍️ Revisor de português: como funciona e o que ele não faz

- **Local e sem custo.** Regras em JSON e dicionário em arquivo estático. Nada do texto sai da página.
- **Só sinaliza.** Nada muda sem aceite item a item (Zero-Tampering). Apenas correções mecânicas de baixo risco (`fix` na regra) viram proposta no diff.
- **Ortografia.** O dicionário vem do VERO 3.2 (Hunspell pt-BR, licença LGPL-3.0 OU MPL-2.0; cópia em `data/ortografia/LICENCA-VERO.txt`), expandido por `tools/gerar-dicionario.mjs` e guardado em um filtro de Bloom (2,8 milhões de formas). Palavras do dicionário nunca são recusadas; cerca de 0,05% de palavras erradas podem ser aceitas por acaso (falso positivo do filtro). Nomes próprios, siglas, CamelCase, números e termos que você pôr em “palavras a ignorar” não são marcados.
- **Limites reais.** Crase, concordância à distância e regência dependem de sintaxe; as regras locais cobrem os casos de padrão fixo e a IA (copiar-e-colar) confirma o resto. Isto não substitui revisão humana de texto que vai ser publicado.
- **CLI.** `node src/core/cli.mjs portugues texto.txt --registro academico --ortografia [--json]`.
- **Regenerar o dicionário.** `npm install && npm run dicionario`.
