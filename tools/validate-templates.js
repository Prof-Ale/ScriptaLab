// Valida os perfis de templates-ies/ contra o schema.  Uso: npm install && npm run validate
const fs = require("fs"), path = require("path");
const Ajv = require("ajv"), addFormats = require("ajv-formats");
const dir = path.join(__dirname, "..", "templates-ies");
const ajv = new Ajv({ allErrors: true }); addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(dir, "schema.json"), "utf8")));
let bad = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "schema.json")) {
  const ok = validate(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  console.log((ok ? "OK   " : "ERRO ") + f);
  if (!ok) { bad++; for (const e of validate.errors) console.log("     " + e.instancePath + " " + e.message); }
}
// O <select> de index.html só pode listar perfis que existem
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
for (const m of html.matchAll(/<option value="([^"]+\.json)"/g)) {
  if (!fs.existsSync(path.join(dir, m[1]))) { console.log("ERRO index.html referencia perfil inexistente: " + m[1]); bad++; }
}
process.exit(bad ? 1 : 0);
