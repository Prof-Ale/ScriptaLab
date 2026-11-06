# ✒️ ScriptaLab | LabTech

[![Status do Projeto](https://img.shields.io/badge/Status-MVP%20Fase%201%20Ativo-22c55e?style=for-the-badge)](https://prof-ale.github.io/ScriptaLab/)
[![Norma ABNT](https://img.shields.io/badge/ABNT-NBR%2010520%3A2023%20%7C%2014724-38bdf8?style=for-the-badge)](https://prof-ale.github.io/ScriptaLab/)
[![Ecossistema](https://img.shields.io/badge/Ecossistema-MathLab%20Educa%C3%A7%C3%A3o-8b5cf6?style=for-the-badge)](https://prof-ale.github.io/MathLab/)
[![Arquitetura](https://img.shields.io/badge/Privacidade-100%25%20Client--Side-eab308?style=for-the-badge)](#arquitetura-e-privacidade-zero-retention)

> **Engenharia textual, higienização de artefatos de IA, estilometria acadêmica, auditoria de DOIs e compilação normativa parametrizada (ABNT e Manuais de IES).**  
> Uma solução tecnológica **LabTech** integrante do ecossistema **[MathLab Educação](https://prof-ale.github.io/MathLab/)**.

---

## 🎯 Sobre o Projeto

O **ScriptaLab** é uma aplicação web progressiva (*Client-Side First*) desenvolvida para pesquisadores, docentes e estudantes de graduação e pós-graduação. A plataforma reúne em um único ambiente gratuito as funções de **limpeza profunda de marcações de LLMs**, **humanização estilométrica**, **verificação anti-alucinação bibliográfica** e **formatação estrutural automatizada**.

Diferente de editores comuns ou reescritores superficiais, o ScriptaLab atua diretamente na estrutura sintática e normativa do texto científico, garantindo conformidade com as atualizações mais recentes da **ABNT (incluindo a NBR 10520:2023)** e permitindo a aplicação de regras específicas de manuais de Instituições de Ensino Superior (UNESP, IFSP, UNICAMP, USP, entre outras) via arquivos de configuração abertos (`.json`).

🔗 **Acesse a aplicação online:** [https://prof-ale.github.io/ScriptaLab/](https://prof-ale.github.io/ScriptaLab/)

---

## ⚙️ Os 5 Módulos da Plataforma

### 1. 🧹 AI Scrubber (Higienização de Artefatos e Metadados)
Remove instantaneamente assinaturas técnicas e resíduos invisíveis deixados por modelos de linguagem (ChatGPT, Claude, Perplexity, Gemini):
* Exclusão de marcações de citação fantasmas (`【4:0†source】`, `[oai_citation:...]`, `[1]`).
* Limpeza de parâmetros de rastreamento em URLs (`?utm_source=chatgpt.com`, `&utm_medium=referral`).
* Expurgo de caracteres Unicode ocultos e marcas d'água invisíveis (*Zero-Width Spaces* `\u200B`, `\u200C`, `\uFEFF` e *Narrow No-Break Spaces* `\u202F`).
* Normalização tipográfica de travessões excessivos (*em-dashes* `—`) para pontuação acadêmica fluida.

### 2. 📊 Estilometria e Humanização Acadêmica
Analisa matematicamente a estrutura dos períodos para eliminar a monotonia sintática típica de textos gerados artificialmente:
* **Medidor de Burstiness (Ritmo Sintático):** Calcula o Coeficiente de Variação ($CV = \frac{\sigma}{\mu} \times 100$) do comprimento das frases em palavras, gerando um gráfico de barras em tempo real para auxiliar o autor a alternar períodos curtos e analíticos.
* **Radar de Clichês de IA (PT-BR):** Identifica e destaca conectivos e expressões desgastadas por LLMs (*"Nesse sentido"*, *"Vale ressaltar"*, *"No cenário atual"*, *"Uma rica tapeçaria"*, *"Não é apenas X, mas sim Y"*), exibindo sugestões de vocabulário acadêmico autêntico ao passar o mouse.

### 3. 🔍 Auditoria de Integridade e Anti-Alucinação Bibliográfica *(Em implementação)*
* Validação automática de referências e citações cruzando dados em tempo real com as APIs abertas da **CrossRef**, **OpenAlex** e **Semantic Scholar**.
* Detecção imediata de "alucinações bibliográficas" (artigos ou DOIs inexistentes gerados por IA).

### 4. 📐 Motor Normativo ABNT Atualizado (Pós-2023)
* **NBR 10520:2023:** Conversão automática de citações parentéticas do padrão antigo em caixa alta `(SILVA, 2023, p. 45)` para o padrão vigente com apenas a inicial maiúscula `(Silva, 2023, p. 45)`.
* **Grafia de *et al.*:** Aplicação automática de itálico na expressão *et al.*, conforme diretriz atualizada.
* **NBR 14724 e NBR 6023:** Padronização de recuos de citações longas (mais de 3 linhas), espaçamento e ordenação alfabética de referências.

### 5. 🏛️ Motor de Manuais Personalizados de IES (JSON Schema)
Cada universidade ou programa de pós-graduação possui particularidades normativas. O ScriptaLab separa o conteúdo da formatação através de perfis modulares em JSON localizados na pasta `/templates-ies/`.

---

## 🔒 Arquitetura e Privacidade (Zero-Retention)

Pesquisas inéditas, dissertações, teses e artigos exigem sigilo absoluto antes da publicação.  
Por operar sob arquitetura **100% Client-Side** no navegador via GitHub Pages:
1. **Nenhum texto é enviado ou armazenado em servidores proprietários.**
2. Todo o processamento de expressões regulares, cálculo estatístico de *burstiness* e compilação de documentos ocorre na memória local do dispositivo do usuário.
3. Consultas externas (quando acionadas no Módulo 3) restringem-se exclusivamente aos metadados públicos de DOI nas bases científicas abertas.

---

## 📁 Estrutura do Repositório

```text
ScriptaLab/
├── index.html                  # Interface principal (Workspace de duas colunas + Dashboard)
├── README.md                   # Documentação oficial do projeto
├── assets/
│   ├── css/
│   │   ├── style.css           # Design System LabTech (Dark Mode Acadêmico)
│   │   └── abnt-preview.css    # Folha de estilo de paginação A4
│   └── img/
│       └── logo-labtech.svg    # Identidade visual da submarca LabTech
├── src/
│   ├── app.js                  # Controlador principal da interface e eventos
│   ├── modules/
│   │   ├── scrubber.js         # [Fase 1] Limpeza de rastros de IA, links UTM e Unicode oculto
│   │   ├── stylometry.js       # [Fase 1] Cálculo de Burstiness e Radar de Clichês PT-BR
│   │   ├── doi-auditor.js      # [Fase 2] Validação anti-alucinação via API CrossRef/OpenAlex
│   │   └── abnt-compiler.js    # [Fase 3] Motor NBR 10520:
