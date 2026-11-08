# Como adicionar um perfil de instituição

1. Copie `_modelo-vazio.json` para `sigla-curso.json` (minúsculas e hífens).
2. Preencha **somente o que o manual oficial da instituição diz**. Valores não verificados devem ficar com `"status": "em-validacao"`.
3. Registre em `sources` o link do manual e em `verifiedOn` a data da conferência. Use `scopeNote` se o manual restringe o uso (curso, campus, tipo de trabalho).
4. Informe as edições das normas em `norms` (ex.: `"nbr14724": "2024"`).
5. Rode `npm install && npm run validate`.
6. Inclua o arquivo em `index.html` (`<select id="ies">` e, se quiser uso offline, no objeto `FALLBACK`).

Campos já aplicados pelo exportador `.docx`: margens, fonte, tamanho, espaçamento entre linhas, recuo da primeira linha, espaço após parágrafo e a citação longa (recuo, fonte e espaçamento). Os demais (`citationStyle`, `etAlFromAuthors`, `notes`) são informativos por enquanto.

Perfis ABNT já incluídos: ABNT Padrão, USP (Parte I – ABNT), UNICAMP (IN CCPG nº 06/2025), UNESP (Rede de Bibliotecas CGB), IFSP e IFSULDEMINAS (Campus Carmo de Minas – Administração). Se você tiver o PDF ou o link do manual vigente de outra instituição ou variante (ex.: USP Parte II – APA ou Parte III – Vancouver), abra um *issue* ou envie o arquivo para preencher o perfil com as fontes.
