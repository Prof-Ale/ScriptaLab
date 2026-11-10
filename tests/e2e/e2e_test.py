"""Teste ponta a ponta no navegador (Playwright + Chromium).

Uso:  pip install playwright && playwright install chromium
      python tests/e2e/e2e_test.py

As bibliotecas vêm do CDN real. Sem internet, aponte SCRIPTALAB_LIBS_DIR para uma pasta com:
  docx/build/index.umd.js · mammoth/mammoth.browser.min.js · pdfjs/build/pdf.min.js · pdfjs/build/pdf.worker.min.js
As APIs (CrossRef/OpenAlex) são sempre simuladas: o teste não consulta a rede.
"""
import json, os, re, sys, threading, zipfile, io, tempfile, functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LIBS = os.environ.get("SCRIPTALAB_LIBS_DIR")
fails, passes = [], 0

def check(name, cond, extra=""):
    global passes
    if cond: passes += 1; print("  ok  ", name)
    else: fails.append(name); print("  FAIL", name, extra)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Quiet, directory=ROOT)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def local_lib(url):
    if not LIBS: return None
    m = {"docx@8.5.0/build/index.umd.js": "docx/build/index.umd.js",
         "mammoth/1.6.0/mammoth.browser.min.js": "mammoth/mammoth.browser.min.js",
         "pdf.js/3.11.174/pdf.min.js": "pdfjs/build/pdf.min.js",
         "pdf.js/3.11.174/pdf.worker.min.js": "pdfjs/build/pdf.worker.min.js"}
    for k, v in m.items():
        if url.endswith(k): return open(os.path.join(LIBS, v), "rb").read()
    return None

CR_DOI_OK = {"message": {"title": ["Aprendizagem de matemática com jogos digitais"], "author": [{"family": "Silva"}], "issued": {"date-parts": [[2020]]}}}
OA_CALLS = []
def api_route(route):
    u = route.request.url
    def js(obj, status=200): route.fulfill(status=status, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(obj))
    if "/agency" in u:
        return js({"message": {"agency": {"id": "datacite", "label": "DataCite"}}}) if "10.5281" in u else js({}, 404)
    if "api.crossref.org/works/10.1000" in u: return js(CR_DOI_OK)
    if "api.crossref.org/works/" in u: return js({}, 404)
    if "query.author=Mantoan" in u: return js({"message": {"items": [{"DOI": "10.1234/inclusao", "title": ["Inclusão escolar"], "author": [{"family": "Mantoan"}]}]}})
    if "api.crossref.org/works?" in u: return js({"message": {"items": []}})
    if "api.openalex.org" in u:
        OA_CALLS.append(u); return js({"message": "cota"}, 409)
    route.abort()

def main():
    srv = serve(); base = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(accept_downloads=True); page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        def cdn(route):
            body = local_lib(route.request.url)
            if body is not None: route.fulfill(status=200, content_type="application/javascript", headers={"access-control-allow-origin": "*"}, body=body)
            else: route.continue_()
        page.route(re.compile(r"https://(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)/.*"), cdn)
        page.route(re.compile(r"https://api\.(crossref|openalex)\.org/.*"), api_route)

        print("Carregamento, SRI e CSP")
        page.goto(base); page.wait_for_timeout(600)
        check("docx/mammoth/pdf.js carregaram com SRI", page.evaluate("!!(window.docx && window.mammoth && window.pdfjsLib)"))
        check("sem erros de console/CSP no carregamento", not errors, errors)
        blocked = page.evaluate("fetch('https://example.com/x').then(()=>false).catch(()=>true)")
        check("CSP bloqueia envio para domínio não listado", blocked)

        print("Normatização")
        page.click("text=Exemplo"); page.click("#btnDiag"); page.click("#btnAuth")
        out = page.inner_text("#out")
        check("(MANTOAN, 2015) virou (Mantoan, 2015)", "(Mantoan, 2015, p. 34)" in out)
        check("rastros 【…】 removidos", "【" not in out and "†source" not in out)
        check("et al. em itálico", page.locator("#out em.fix").count() >= 1)
        page.fill("#raw", "Dados do IBGE (IBGE, 2020) e (SILVA, 2020).")
        page.click("#btnDiag"); page.click("#btnAuth")
        out = page.inner_text("#out")
        check("sigla IBGE mantida em maiúsculas", "(IBGE, 2020)" in out and "(Silva, 2020)" in out, out)

        print("Estilometria (Zero-Tampering)")
        page.click("text=Exemplo"); raw_before = page.input_value("#raw"); page.click("#btnAuth")
        clean_before = page.inner_text("#out"); page.click("#btnStyle")
        check("barras por período", page.locator("#styleBars .bar").count() >= 4)
        check("CV exibido", "Burstiness" in page.inner_text("#styleStats") and "%" in page.inner_text("#styleStats"))
        check("clichês destacados", page.locator("#styleOut mark.cl").count() >= 3)
        check("texto bruto intacto", page.input_value("#raw") == raw_before)
        check("texto normatizado intacto", page.inner_text("#out") == clean_before)
        page.locator("#styleBars .bar").first.click()
        check("clique na barra mostra o período", "Período 1" in page.inner_text("#styleDetail"))

        print("Exportação .docx por perfil")
        page.select_option("#ies", "ifsuldeminas-carmo-tcc-artigo.json"); page.wait_for_timeout(300)
        check("aviso de escopo do perfil", "restringe" in page.inner_text("#scope"))
        with page.expect_download() as dl: page.click("text=Baixar Word")
        d = dl.value; path = d.path()
        xml = zipfile.ZipFile(path).read("word/document.xml").decode()
        check("nome do arquivo usa o perfil", "ifsuldeminas-carmo-tcc-artigo" in d.suggested_filename)
        check("fonte Arial no .docx", 'w:ascii="Arial"' in xml)
        check("sem espaço entre parágrafos (after=0)", 'w:after="0"' in xml)
        check("recuo de 4 cm na citação longa (≈2268 twips)", 'w:left="2267"' in xml or 'w:left="2268"' in xml)

        print("Upload TXT / DOCX / PDF")
        tmp = tempfile.mkdtemp()
        txt = os.path.join(tmp, "a.txt"); open(txt, "w", encoding="utf-8").write("Texto simples de teste.")
        page.set_input_files("#fileInput", txt); page.wait_for_timeout(300)
        check("TXT extraído", "Texto simples" in page.input_value("#raw"))
        try:
            import docx as pydocx
            f = os.path.join(tmp, "a.docx"); dd = pydocx.Document(); dd.add_paragraph("Parágrafo vindo do Word."); dd.save(f)
            page.set_input_files("#fileInput", f); page.wait_for_timeout(800)
            check("DOCX extraído (mammoth)", "vindo do Word" in page.input_value("#raw"))
        except ImportError: print("  (python-docx ausente: DOCX pulado)")
        try:
            from reportlab.pdfgen import canvas
            f = os.path.join(tmp, "a.pdf"); c = canvas.Canvas(f); c.drawString(72, 750, "Conteudo extraido do PDF de teste"); c.save()
            page.set_input_files("#fileInput", f); page.wait_for_timeout(2500)
            check("PDF extraído (worker verificado por SRI)", "extraido do PDF" in page.input_value("#raw"), page.inner_text("#status"))
        except ImportError: print("  (reportlab ausente: PDF pulado)")

        print("Auditor (APIs simuladas)")
        doc = ("Segundo Mantoan (2015) e (SILVA, 2020; SOUZA, 2019).\n\nREFERÊNCIAS\n\n"
               "SILVA, Ana. Aprendizagem de matemática com jogos digitais. Revista X, 2020. DOI 10.1000/ok.\n"
               "LIMA, Bruno. Quantum chromodynamics lattice simulations. Rio: Y, 2018. https://doi.org/10.9999/fake\n"
               "SANTOS, Caio. Dados abertos. Zenodo, 2021. https://doi.org/10.5281/zenodo.123\n"
               "MANTOAN, Maria. Inclusão escolar. São Paulo: Moderna, 2015.\n")
        page.fill("#raw", doc); page.click("#btnDiag"); page.click("#btnAuth")
        page.click("#btnAudit"); page.wait_for_selector("#btnAudit:has-text('Verificar')", timeout=30000)
        a = page.inner_text("#audit")
        check("citação sem referência (Souza, 2019)", "sem referência correspondente" in a and "Souza" in a)
        check("referência sem citação (Lima)", "sem citação localizada" in a)
        check("DOI coerente com a referência", "coerente" in a)
        check("DOI inexistente sinalizado", "não está registrado" in a)
        check("DOI de outra agência reconhecido", "DataCite" in a)
        check("Autor+Ano encontrado na CrossRef", "Inclusão escolar" in a and "CrossRef" in a)
        check("Autor+Ano sem obra vira aviso", "nenhuma obra compatível" in a)
        check("OpenAlex 409 é silencioso (sem cartão de erro)", "Erro na consulta" not in a and "409" not in a)
        check("OpenAlex desliga após o 1º 409 (1 chamada, sem retry)", len(OA_CALLS) == 1, OA_CALLS)
        page.fill("#apiMail", "teste@exemplo.com"); page.fill("#oaKey", "chave123")
        page.reload(); page.wait_for_timeout(500)
        check("e-mail e chave restaurados da sessão", page.input_value("#apiMail") == "teste@exemplo.com" and page.input_value("#oaKey") == "chave123")
        check("cache da CrossRef sem mailto/api_key na chave", not any("mailto" in k or "api_key" in k for k in page.evaluate("Object.keys(sessionStorage)")))
        check("nada em localStorage", page.evaluate("localStorage.length") == 0)
        b.close()
    srv.shutdown()
    print(f"\n{passes} ok, {len(fails)} falhas"); sys.exit(1 if fails else 0)

if __name__ == "__main__": main()
