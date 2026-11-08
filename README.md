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

O ScriptaLab roda inteiramente no navegador (*client-side first*, um único `index.html`, sem build). Ele **mede e sinaliza** problemas no texto e só altera algo quando a pessoa clica em *Autorizar Correções*. O princípio é o **Zero-Tampering**: vocabulário, argumentos e conclusões do autor não são reescritos.

Os indicadores de estilo e as buscas bibliográficas são **apoio à revisão**: não provam autoria nem uso de IA, e uma obra "não encontrada" não é prova de invenção.

---

## ⚙️ Módulos (estado real)

| Módulo | Estado | O que faz |
|---|---|---|
| 🧹 **Scrubber** | ✅ pronto | Remove `【4:0†source】` e `[oai_citation:…]`, parâmetros `?utm_*`, caracteres Unicode invisíveis (`U+200B–200D`, `U+2060`, `U+FEFF`, `U+202F`) e une palavras quebradas por hífen no fim da linha. |
| 📊 **Estilometria** | ✅ novo | Burstiness (CV = σ/μ × 100 do nº de palavras por período, σ populacional) com gráfico de barras por período; radar de clichês PT-BR com sugestões ao passar o mouse; contagem de travessões longos (`—`). **Só lê o texto.** |
| 🔍 **Auditor** | ✅ reformulado | Citações no texto × lista de referências; DOIs na CrossRef (inclui checagem de agência para DOIs de DataCite) e **comparação com a referência colada ao lado do DOI**; Autor+Ano na CrossRef, com OpenAlex como apoio opcional. |
| 📐 **Motor ABNT** | 🟡 parcial | NBR 10520:2023: `(SILVA, 2023)` → `(Silva, 2023)` (siglas como IBGE e FGV permanecem em maiúsculas); *et al.* e *apud* em itálico; alerta de uniformidade para 4+ coautores vs *et al.*; citação longa com recuo/fonte/espaçamento do perfil. |
| 🏛️ **Perfis de IES** | 🟡 parcial | JSON validado por schema em `templates-ies/`. Exportação `.docx` aplica margens, fonte, entrelinhas, recuo de parágrafo, espaço entre parágrafos e citação longa. |

**Ainda não implementado** (aparecia na versão anterior do README): remoção de `[1]`, normalização de travessões, ordenação alfabética de referências, Semantic Scholar, numeração de páginas e demais itens da NBR 14724 no `.docx`.

### Como o Auditor funciona
- **Sem chave:** usa a CrossRef pública. O e-mail (opcional) entra como `mailto` e coloca a consulta no *polite pool*. Fila sequencial (150 ms por registro e 400 ms por busca com e-mail; 250 ms e 1,1 s sem e-mail), `Retry-After` respeitado e cache na sessão. Os limites vigentes da CrossRef são divulgados por ela e mudam; confira antes de aumentar a taxa.
- **OpenAlex:** exige chave gratuita desde fev/2026. É **opcional**: o usuário pode colar a própria chave (guardada só em `sessionStorage`). Sem chave, o auditor tenta a cota gratuita uma vez e, ao primeiro 401/403/409/429, desliga o OpenAlex em silêncio na sessão.
- **Limites a conhecer:** livros, capítulos, normas e documentos sem DOI são mal cobertos pela CrossRef; "nenhuma obra compatível" pede verificação manual.

---

## 🔒 Arquitetura e privacidade (Zero-Retention)

1. **O texto nunca é enviado.** Só saem do navegador DOIs e pares sobrenome+ano, para `api.crossref.org` (e `api.openalex.org`, se houver chave ou cota).
2. **CSP restritiva** (`<meta http-equiv="Content-Security-Policy">`): `connect-src` só aceita CrossRef, OpenAlex e o CDN do worker do PDF; sem imagens remotas, sem formulários.
3. **Bibliotecas com versão fixa e SRI (SHA-384):** `docx@8.5.0`, `mammoth@1.6.0`, `pdf.js@3.11.174`. O *worker* do pdf.js é baixado com `fetch(..., {integrity})` e executado a partir de um `Blob`, porque `workerSrc` não aceita SRI.
4. **pdf.js:** versões < 4.2.67 têm a falha CVE-2024-4367 (execução de JS por fonte maliciosa em PDF). Mitigação aplicada: `isEvalSupported: false`. Migração para a série 4.x (módulos ES) está no roteiro.
5. `sessionStorage` guarda apenas e-mail opcional, chave opcional e cache das respostas; some ao fechar a aba. Nada vai para `localStorage`.

---

## 📐 Regras ABNT aplicadas (com fonte)

| Regra | Norma | Fonte consultada |
|---|---|---|
| Sobrenome em citação parentética só com inicial maiúscula; caixa alta permanece nas referências | NBR 10520:2023 | [IFCE – Atualizações](https://portal.ifce.edu.br/documents/3352/ANEXO_-__Atualiza%C3%A7%C3%B5es_da_ABNT_NBR_10520-2023.pdf), [UniCesumar](https://rdu.unicesumar.edu.br/bitstream/123456789/9937/1/NBR%2010520%20-%20Atualiza%c3%a7%c3%b5es) |
| Siglas de instituições permanecem em maiúsculas | NBR 10520:2023 | material institucional (ver acima) |
| *et al.* e *apud* em itálico | NBR 10520:2023 | idem |
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
├── index.html                 # App completo: interface, núcleo (<script id="core">) e controlador
├── manifest.webmanifest       # Manifesto PWA
├── favicon.svg / favicon-*.png / icon-*.png / icon-app.svg / logo-horizontal.svg / avatar.*
├── data/
│   └── cliches-ptbr.json      # Lista editável do radar de clichês (espelha o padrão embutido)
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
│   ├── core.test.js           # 15 testes unitários do núcleo (Node, sem dependências)
│   └── e2e/e2e_test.py        # 33 verificações no navegador (Playwright; APIs simuladas)
├── tools/
│   ├── validate-templates.js  # valida perfis contra o schema
│   └── sri.sh                 # confere/recalcula os hashes SRI contra os CDNs
├── .github/workflows/ci.yml   # testes + schema + SRI a cada push
└── package.json
```

Desenvolvimento local: `npm install && npm run check`. Para servir a página (necessário para carregar os JSON): `python3 -m http.server`.

---

## 🗺️ Roteiro

- [ ] Migrar para pdf.js 4.x (módulos ES) com verificação de integridade
- [x] Perfis IFSP, USP, UNICAMP e UNESP a partir dos manuais oficiais (ABNT)
- [x] Campo `citationStyle` (ABNT, APA, Vancouver, ISO) no schema
- [ ] Numeração de páginas e fonte menor em notas/legendas no `.docx`
- [ ] Ordenação alfabética e checagem de formato das referências (NBR 6023:2025)
- [ ] Diferença antes/depois e desfazer por item
