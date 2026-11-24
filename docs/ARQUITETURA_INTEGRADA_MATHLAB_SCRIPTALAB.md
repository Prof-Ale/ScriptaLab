# Arquitetura Integrada — Ecossistema MathLab App ↔ ScriptaLab

**Versão:** `1.0.0`  
**Data:** `2026-11-24`  
**Direção:** Prof. Alê Chocolate  
**Status:** Formalizado para execução incremental (Blocos 1 a 4)  
**Repositórios abrangidos:**
- `MathLab_Aulas_Visuais_App` (Node.js — motor epistêmico, didático e de produção estruturada)
- `ScriptaLab` (PWA Client-Side / ESM — higienização, estilometria, revisão literária e normatização ABNT/IES)

---

## 1. Propósito e Princípios Inegociáveis

Este documento formaliza a divisão arquitetural, o contrato de interoperabilidade e o plano de evolução em 4 blocos para levar o ecossistema **MathLab + ScriptaLab** ao estado da arte em produção de livros, apostilas, textos acadêmicos e revisão literária assistida por IA, sem duplicação de código e sem perda de rigor científico.

Toda evolução nos dois repositórios deve obedecer a quatro invariantes:

1. **Inteligência Epistêmica (MathLab):** nenhuma regra de um domínio vaza para outro; o sistema declara explicitamente o que auditou, o que não exigiu e quais são os limites da automação.
2. **Zero-Tampering (ScriptaLab):** o sistema **mede, sinaliza e propõe**, mas jamais reescreve vocabulário, argumentos, citações ou conclusões do autor sem autorização explícita por item.
3. **Zero-Retention (ScriptaLab):** o texto integral do autor não é enviado a servidores externos no fluxo padrão do ScriptaLab (saem apenas DOIs e pares autor+ano quando o auditor bibliográfico é acionado); toda chamada de IA externa no MathLab exige autorização explícita.
4. **Soberania Humana:** nenhuma IA, ponte ou importação pode promover automaticamente um material, plano, domínio ou livro ao estado de validado/aprovado por humano. Toda alteração aplicada invalida a validação humana anterior.

---

## 2. Linha de Base Verificada (Estado Atual)

| Repositório | Referência Git | Suíte Verificada | Capacidades Consolidadas |
| :--- | :--- | :--- | :--- |
| **`MathLab_Aulas_Visuais_App`** | `main` (`710e9c7`) | `207/207` testes Node (`0` falhas) | M01–M05 preservados em `knowledge_docs/` (SHA-256), 17 adaptadores + Meta Adaptador, memória cumulativa (`projectMemory.js`), pasta de fontes do autor (`authorSources.js`), plano por unidades (`blueprintFlow.js`), auditoria M05 D1–D4, reparo guiado (`repairFlow.js`), compilador de livro (`bookCompiler.js`), ponte bidirecional `mathlab.material/2`. |
| **`ScriptaLab`** | `main` (`3ad4ee3`) | `17/17` testes unitários Node + `33` E2E Playwright | Scrubber de artefatos de IA, Estilometria (CV $\sigma/\mu$, radar de clichês PT-BR em `data/cliches-ptbr.json`, travessões), Auditor CrossRef-first (+ OpenAlex opcional), Motor ABNT NBR 10520:2023, 7 perfis de IES verificados em `templates-ies/` com JSON Schema, exportação `.docx`, CSP + SRI SHA-384. |

---

## 3. Fronteira de Responsabilidades (Matriz de Ecossistema)

Para evitar sobreposição e manter cada projeto coeso:

| Responsabilidade | Dono Canônico | Papel do Outro Repositório |
| :--- | :--- | :--- |
| Base epistemológica (M01–M05), 17 domínios e Meta Adaptador | `MathLab_Aulas_Visuais_App` | Consome metadados de área/natureza via contrato |
| Blueprint de obra/apostila por unidades e memória cumulativa | `MathLab_Aulas_Visuais_App` | Recebe unidades ou livro compilado para acabamento |
| Pasta de fontes do autor e proveniência (5 estados) | `MathLab_Aulas_Visuais_App` | Preserva proveniência; nunca promove fonte não consultada |
| Auditoria M05 (D1 Estrutural, D2 Epistêmica, D3 Documental, D4 Editorial) | `MathLab_Aulas_Visuais_App` | Recebe alertas complementares de estilo e ABNT |
| Scrubber de artefatos de IA e higiene tipográfica | `ScriptaLab` | Consome núcleo ESM ou arquivo revisado |
| Estilometria profunda, radar de clichês e `VoiceProfile` | `ScriptaLab` | Integra métricas e gera reparos cirúrgicos via `repairFlow.js` |
| Revisão literária em camadas (ritmo, coesão, fluidez, diff por item) | `ScriptaLab` | Aplica revisões autorizadas por ID de bloco |
| Auditor bibliográfico externo (CrossRef-first / OpenAlex) | `ScriptaLab` | Complementa D3 sem alterar status de consulta integral |
| Normatização ABNT (NBR 10520:2023, NBR 6023:2025, NBR 14724:2024) e Perfis de IES | `ScriptaLab` | Consome perfis/formatador no `bookCompiler.js` e exportações |
| Compilação de livro multiunidade com folha de revisão honesta | `MathLab_Aulas_Visuais_App` | Exporta/recebe estilização ABNT/IES para acabamento `.docx`/A4 |

---

## 4. Arquitetura Técnica dos 4 Blocos de Evolução

### Bloco 1 — Fundação Modular do `ScriptaLab`
**Objetivo:** eliminar o gargalo do arquivo monolítico `index.html` preservando execução **zero-build** no GitHub Pages e habilitando reutilização direta em Node.js.

- **Extração do núcleo puro para ESM (`ScriptaLab/src/core/`):**
  - `scrubber.js` — limpeza de marcadores de IA, Unicode invisível, URLs `utm_*` e hifens de quebra de linha.
  - `stylometry.js` — segmentação de períodos, CV ($\sigma/\mu$), radar de clichês PT-BR e métricas de travessões.
  - `abnt10520.js` — normalização de citações parentéticas/narrativas, siglas, itálico em expressões latinas, uniformidade de *et al.* e pontuação final.
  - `citationAuditor.js` — cruzamento citação × referência, extração de DOIs e comparação CrossRef/OpenAlex (cliente HTTP injetável para testes offline).
  - `iesProfiles.js` — carregamento e validação de perfis em `templates-ies/`.
  - `diffEngine.js` — representação de sugestões por intervalo/parágrafo com **preview antes/depois** e **aceitar/desfazer por item**.
- **Compatibilidade Web + Node:** `index.html` passa a carregar o núcleo via `<script type="module">` mantendo CSP restritiva e Zero-Retention.
- **Segurança PDF:** migrar `pdf.js 3.11.174` para `pdf.js 4.x` (módulos ES com SRI), eliminando a superfície da CVE-2024-4367.

---

### Bloco 2 — Motor ABNT Completo (2023 / 2024 / 2025) e Perfis de IES
**Objetivo:** sair da normatização parcial para conformidade determinística auditável, sempre com fonte normativa documentada.

- **NBR 6023:2025 (`ScriptaLab/src/core/abnt6023.js`):**
  - Parser e verificador estrutural de referências (livro, capítulo, artigo com DOI/URL, legislação/BNCC, tese/dissertação).
  - Ordenação alfabética automática (opt-in) respeitando sobrenomes compostos, partículas e entradas institucionais.
  - Sinalização explícita de campos ausentes (local, editora, ano, acesso) — **proibido inventar metadados faltantes**.
- **NBR 10520:2023 (consolidação):**
  - Cruzamento bidirecional completo citação ↔ referência, com detecção de `apud` e obrigatoriedade de página em citação direta.
- **NBR 14724:2024 no exportador `.docx` (`ScriptaLab/src/export/docxAbnt.js`):**
  - Numeração de páginas conforme perfil de IES (contagem a partir da folha de rosto, exibição a partir dos elementos textuais).
  - Estilos tipográficos reais para notas de rodapé, legendas/fontes de figuras e tabelas (fonte menor, espaço simples).
  - Elementos pré-textuais e pós-textuais parametrizados por perfil (`USP`, `UNICAMP`, `UNESP`, `IFSP`, `ABNT Padrão 2023`).

---

### Bloco 3 — Estilometria Profunda, Perfil de Voz Autoral e Revisão Literária em Camadas
**Objetivo:** substituir "humanização superficial por sinônimos" por **engenharia estilística e revisão literária real**, preservando integralmente o conteúdo científico.

1. **Camada 1 — Diagnóstico Estilométrico Determinístico (`stylometry.js` v2):**
   - **Variação rítmica (*burstiness*):** CV global e por seção (alerta de trechos excessivamente uniformes).
   - **Padrões sintáticos típicos de LLM:** tríades adjetivas repetidas, listas consecutivas com padrão `**Rótulo:** explicação`, parágrafos de extensão gêmea e abertura repetitiva de parágrafos.
   - **Diversidade lexical e redundância:** densidade de termos repetidos em janela curta e conectivos mecânicos.
2. **Camada 2 — Perfil de Voz Autoral (`VoiceProfile`):**
   - Arquivo JSON local (opt-in, armazenado apenas sob controle do autor) calibrado a partir de 2 a 3 textos autênticos do próprio professor/escritor: faixa típica de tamanho de frase, grau de dialogicidade, marcadores preferidos e vocabulário característico.
   - Serve como referência comparativa ("quão distante este rascunho está da sua voz real?"), nunca como detector punitivo.
3. **Camada 3 — Revisão Literária em 3 Passadas (integrada ao `repairFlow.js`):**
   - **Passada Epistêmica (M05):** verdade disciplinar, fontes e D1–D4.
   - **Passada Literária/Estrutural:** coesão entre capítulos/blocos, progressão conceitual, clareza argumentativa e ritmo de leitura.
   - **Passada de Copidesque/ABNT:** ortografia, padronização terminológica e normas.
   - **Trava de Preservação Conceitual:** qualquer proposta de reescrita estilística só pode ser aplicada se mantiver intactos números, fórmulas matemáticas/LaTeX, citações `(Autor, ano)` e marcadores de fonte — sempre exibida em **diff por bloco** e sujeita a aceite humano.

---

### Bloco 4 — Ponte Bidirecional `MathLab App` ↔ `ScriptaLab`
**Objetivo:** conectar os dois ambientes no mesmo padrão contratual que já validou a integração App ↔ Site (`mathlab.material/2`).

```text
[MathLab App]
  1. Produz unidade/apostila/livro (M01–M05 + blueprint + fontes + D1–D4)
  2. Exporta .mathlab.json (contrato mathlab.material/2, v2.1+)
        │
        ▼
[ScriptaLab]
  3. Abre .mathlab.json preservando block.id, fontes e proveniência
  4. Executa Scrubber + Estilometria Profunda + Auditor CrossRef + ABNT/IES
  5. Autor revisa diff item a item e aprova apenas correções desejadas
  6. Exporta:
     - .docx / HTML A4 normatizado (ABNT/IES), OU
     - pacote de revisão (scriptalab.review/1) com patches por block.id
        │
        ▼
[MathLab App]
  7. Importa scriptalab.review/1 via repairFlow.js (aplica por block.id)
  8. Reaudita M05 (D1–D4), mostra comparação antes/depois e reseta validação humana
  9. Compila obra final no bookCompiler.js com folha de revisão honesta
```

#### Contrato de Retorno `scriptalab.review/1` (rascunho normativo)
```json
{
  "schema": "scriptalab.review/1",
  "sourceContract": "mathlab.material/2",
  "materialId": "mat_...",
  "profileId": "abnt-padrao-2023",
  "generatedAt": "2026-11-24T00:00:00Z",
  "stylometrySummary": {
    "sentenceCount": 42,
    "cvPercent": 46.8,
    "clicheHits": 2,
    "structuralAlerts": []
  },
  "abntSummary": {
    "citationIssues": 0,
    "referenceIssues": 1,
    "crossrefChecked": 5
  },
  "authorizedPatches": [
    {
      "blockId": "blk_03",
      "category": "abnt_10520 | scrubber | style_human_approved",
      "beforeHash": "sha256:...",
      "body": "Texto revisado e explicitamente autorizado pelo autor"
    }
  ],
  "humanValidationCarried": false
}
```
> **Regra de segurança do contrato:** `humanValidationCarried` é sempre `false`; o `MathLab App` rejeita qualquer tentativa de promover validação humana a partir de arquivo importado e valida `beforeHash` antes de aplicar cada patch.

---

## 5. Critérios de Aceitação e Governança por Bloco

| Bloco | Critérios Mínimos para Aprovação |
| :--- | :--- |
| **Bloco 1** | `ScriptaLab/src/core/*.js` em ESM puro sem build; `index.html` funcional no navegador; `17/17` testes unitários + `33` E2E preservados; novos testes de `diffEngine.js` (aceitar/desfazer por item); `pdf.js 4.x` com SRI verificado. |
| **Bloco 2** | Testes unitários de `abnt6023.js` (ordenação, tipos de obra, campos ausentes sem invenção); `.docx` validado com numeração de páginas e estilos de notas/legendas; todos os perfis de `templates-ies/` passando em `validate-templates.js`. |
| **Bloco 3** | Testes de detecção de padrões sintáticos de IA + `VoiceProfile`; trava automatizada bloqueando patch estilístico que altere fórmulas, números ou citações; fluxo de revisão literária integrado sem mascarar D1–D4. |
| **Bloco 4** | Importação de `.mathlab.json` no `ScriptaLab` + exportação `scriptalab.review/1` + aplicação no `repairFlow.js` do `MathLab App`; conferidor de contrato em CI; `207+` testes no MathLab e `100%` no ScriptaLab aprovados. |

---

## 6. Riscos Conhecidos e Mitigações

- **Risco 1 — Quebrar o GitHub Pages (zero-build) ao modularizar o `ScriptaLab`:** mitigado usando apenas ESM nativo (`import`/`export` com extensões `.js` explícitas) e mantendo teste E2E via servidor HTTP local no CI.
- **Risco 2 — "Humanização" distorcer rigor conceitual ou citações:** mitigado pela trava determinística de preservação de fórmulas/citações/números + diff obrigatório + princípio Zero-Tampering.
- **Risco 3 — Divergência silenciosa entre os dois repositórios:** mitigado pelo contrato versionado (`mathlab.material/2` e `scriptalab.review/1`) com script de conferência em CI, seguindo o modelo já adotado em `tools/conferir-contrato.mjs`.
- **Risco 4 — Falsa sensação de aprovação automática:** mitigado pela regra transversal de que nenhuma métrica estilométrica, consulta CrossRef ou formatação ABNT substitui a revisão intelectual e a validação humana final.
