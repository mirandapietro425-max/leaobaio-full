// ============================================================
//  LEÃO BAIO — Servidor Principal
//  Express + SQLite (better-sqlite3) + Multer (upload imagens)
// ============================================================
require("dotenv").config();

const express     = require("express");
const session     = require("express-session");
const bodyParser  = require("body-parser");
const multer      = require("multer");
const path        = require("path");
const fs          = require("fs");
const Database    = require("better-sqlite3");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Garantir pastas ──────────────────────────────────────────
["uploads", "db"].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Banco de dados SQLite ────────────────────────────────────
const db = new Database("db/leaobaio.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    gender    TEXT    NOT NULL DEFAULT 'Unissex',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    price       REAL    NOT NULL DEFAULT 0,
    price_original REAL DEFAULT 0,
    badge       TEXT    DEFAULT '',
    sizes       TEXT    DEFAULT '[]',
    active      INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    filename   TEXT    NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Seed de configurações padrão
const defaults = {
  admin_password: "leaobaio123",
  store_name:     "Leão Baio",
  hero_title:     "MODA PREMIUM",
  hero_subtitle:  "Estilo que ruge · Qualidade que impõe",
  hero_badge:     "✦ Nova Coleção 2026 ✦",
  announcement:   "✦ FRETE GRÁTIS ACIMA DE R$299 · COLEÇÃO NOVA DISPONÍVEL · DESCONTO DE ATÉ 40% ✦",
  whatsapp:       "(55) 99719-6038",
  email:          "contato@leaobaio.com.br",
  free_shipping_above: "299",
};
for (const [k, v] of Object.entries(defaults)) {
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)").run(k, v);
}

// Seed de categorias de exemplo (só se vazio)
const catCount = db.prepare("SELECT COUNT(*) as n FROM categories").get().n;
if (catCount === 0) {
  const cats = [
    ["Camisetas Masculinas", "Masculino"],
    ["Polos Masculinas",     "Masculino"],
    ["Jaquetas",             "Masculino"],
    ["Camisetas Femininas",  "Feminino"],
    ["Shorts",               "Masculino"],
    ["Acessórios",           "Acessórios"],
  ];
  const insC = db.prepare("INSERT INTO categories(name,gender,sort_order) VALUES(?,?,?)");
  cats.forEach(([name, gender], i) => insC.run(name, gender, i));

  // Produto exemplo
  const catId = db.prepare("SELECT id FROM categories WHERE name='Camisetas Masculinas'").get().id;
  db.prepare(`INSERT INTO products(category_id,name,description,price,price_original,badge,sizes,sort_order)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    catId,
    "Camiseta Leão Signature",
    "Camiseta premium com estampa exclusiva Leão Baio.",
    89.90, 129.90, "NOVO",
    JSON.stringify(["P","M","G","GG","XGG"]),
    0
  );
}

// ── Multer — upload de imagens ───────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpg|jpeg|png|webp|gif/;
    cb(null, allowed.test(file.mimetype));
  },
});

// ── Middlewares ──────────────────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));
app.use("/public",  express.static("public"));
app.use(session({
  secret:            process.env.SESSION_SECRET || "leaobaio_secret_2026",
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 24 * 60 * 60 * 1000 },
}));

// ── Helper: autenticação ─────────────────────────────────────
function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value;
}
function setSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)").run(key, value);
}
function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: "Não autenticado." });
}

// ════════════════════════════════════════════════════════════
//  API PÚBLICA — usada pelo frontend da loja
// ════════════════════════════════════════════════════════════

// GET /api/store — tudo necessário para renderizar a loja
app.get("/api/store", (req, res) => {
  const settings = {};
  db.prepare("SELECT key,value FROM settings").all().forEach(r => settings[r.key] = r.value);

  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order,id").all();

  const products = db.prepare(`
    SELECT p.*,
      (SELECT filename FROM product_images WHERE product_id=p.id ORDER BY sort_order LIMIT 1) as cover
    FROM products p
    WHERE p.active=1
    ORDER BY p.sort_order, p.id
  `).all().map(p => ({ ...p, sizes: JSON.parse(p.sizes || "[]") }));

  const images = db.prepare(`
    SELECT * FROM product_images ORDER BY product_id, sort_order
  `).all();

  res.json({ settings, categories, products, images });
});

// GET /api/product/:id — produto individual com todas as imagens
app.get("/api/product/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Produto não encontrado." });
  p.sizes  = JSON.parse(p.sizes || "[]");
  p.images = db.prepare("SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order").all(p.id);
  const cat = db.prepare("SELECT * FROM categories WHERE id=?").get(p.category_id);
  res.json({ ...p, category: cat });
});

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === getSetting("admin_password")) {
    req.session.admin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: "Senha incorreta." });
  }
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  res.json({ logged: !!req.session.admin });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — CATEGORIAS
// ════════════════════════════════════════════════════════════

app.get("/api/admin/categories", requireAuth, (req, res) => {
  const cats = db.prepare(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id=c.id
    GROUP BY c.id ORDER BY c.sort_order,c.id
  `).all();
  res.json(cats);
});

app.post("/api/admin/categories", requireAuth, (req, res) => {
  const { name, gender, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: "Nome obrigatório." });
  const r = db.prepare(
    "INSERT INTO categories(name,gender,sort_order) VALUES(?,?,?)"
  ).run(name.trim(), gender || "Unissex", sort_order || 0);
  res.json({ id: r.lastInsertRowid, name, gender, sort_order });
});

app.put("/api/admin/categories/:id", requireAuth, (req, res) => {
  const { name, gender, sort_order } = req.body;
  db.prepare("UPDATE categories SET name=?,gender=?,sort_order=? WHERE id=?")
    .run(name, gender, sort_order || 0, req.params.id);
  res.json({ ok: true });
});

app.delete("/api/admin/categories/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM categories WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — PRODUTOS
// ════════════════════════════════════════════════════════════

app.get("/api/admin/products", requireAuth, (req, res) => {
  const products = db.prepare(`
    SELECT p.*,
      c.name as category_name,
      (SELECT filename FROM product_images WHERE product_id=p.id ORDER BY sort_order LIMIT 1) as cover,
      (SELECT COUNT(*) FROM product_images WHERE product_id=p.id) as image_count
    FROM products p
    LEFT JOIN categories c ON c.id=p.category_id
    ORDER BY p.sort_order, p.id DESC
  `).all().map(p => ({ ...p, sizes: JSON.parse(p.sizes || "[]") }));
  res.json(products);
});

app.post("/api/admin/products", requireAuth, (req, res) => {
  const { category_id, name, description, price, price_original, badge, sizes, sort_order } = req.body;
  if (!name || !category_id) return res.status(400).json({ error: "Nome e categoria obrigatórios." });
  const r = db.prepare(`
    INSERT INTO products(category_id,name,description,price,price_original,badge,sizes,sort_order)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(
    category_id, name.trim(), description || "",
    parseFloat(price) || 0, parseFloat(price_original) || 0,
    badge || "", JSON.stringify(Array.isArray(sizes) ? sizes : []),
    sort_order || 0
  );
  res.json({ id: r.lastInsertRowid });
});

app.put("/api/admin/products/:id", requireAuth, (req, res) => {
  const { category_id, name, description, price, price_original, badge, sizes, active, sort_order } = req.body;
  db.prepare(`
    UPDATE products SET
      category_id=?, name=?, description=?, price=?, price_original=?,
      badge=?, sizes=?, active=?, sort_order=?
    WHERE id=?
  `).run(
    category_id, name, description || "",
    parseFloat(price) || 0, parseFloat(price_original) || 0,
    badge || "", JSON.stringify(Array.isArray(sizes) ? sizes : []),
    active !== undefined ? active : 1,
    sort_order || 0,
    req.params.id
  );
  res.json({ ok: true });
});

app.delete("/api/admin/products/:id", requireAuth, (req, res) => {
  // Deletar imagens do disco
  const imgs = db.prepare("SELECT filename FROM product_images WHERE product_id=?").all(req.params.id);
  imgs.forEach(img => {
    try { fs.unlinkSync(path.join("uploads", img.filename)); } catch {}
  });
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — IMAGENS
// ════════════════════════════════════════════════════════════

// Listar imagens de um produto
app.get("/api/admin/products/:id/images", requireAuth, (req, res) => {
  const imgs = db.prepare("SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order").all(req.params.id);
  res.json(imgs);
});

// Upload de imagens (múltiplas)
app.post("/api/admin/products/:id/images", requireAuth, upload.array("images", 50), (req, res) => {
  const productId = req.params.id;
  const product = db.prepare("SELECT id FROM products WHERE id=?").get(productId);
  if (!product) return res.status(404).json({ error: "Produto não encontrado." });

  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order),0) as m FROM product_images WHERE product_id=?")
    .get(productId).m;

  const ins = db.prepare("INSERT INTO product_images(product_id,filename,sort_order) VALUES(?,?,?)");
  const inserted = [];
  (req.files || []).forEach((file, i) => {
    const r = ins.run(productId, file.filename, maxOrder + i + 1);
    inserted.push({ id: r.lastInsertRowid, filename: file.filename, sort_order: maxOrder + i + 1 });
  });

  res.json({ uploaded: inserted.length, images: inserted });
});

// Deletar imagem
app.delete("/api/admin/images/:id", requireAuth, (req, res) => {
  const img = db.prepare("SELECT * FROM product_images WHERE id=?").get(req.params.id);
  if (!img) return res.status(404).json({ error: "Imagem não encontrada." });
  try { fs.unlinkSync(path.join("uploads", img.filename)); } catch {}
  db.prepare("DELETE FROM product_images WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Reordenar imagens
app.put("/api/admin/images/reorder", requireAuth, (req, res) => {
  const { order } = req.body; // [{id, sort_order}]
  const upd = db.prepare("UPDATE product_images SET sort_order=? WHERE id=?");
  (order || []).forEach(({ id, sort_order }) => upd.run(sort_order, id));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════

app.get("/api/admin/settings", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  const s = {};
  rows.forEach(r => s[r.key] = r.value);
  res.json(s);
});

app.put("/api/admin/settings", requireAuth, (req, res) => {
  const allowed = ["store_name","hero_title","hero_subtitle","hero_badge",
                   "announcement","whatsapp","email","free_shipping_above","admin_password"];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) setSetting(k, v);
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  SERVIR FRONTEND (SPA)
// ════════════════════════════════════════════════════════════

// Rota da loja → index.html
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Rota do admin → admin.html
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin/*", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// 404
app.use((req, res) => res.status(404).json({ error: "Rota não encontrada." }));

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  🦁  LEÃO BAIO — rodando em http://localhost:${PORT}`);
  console.log(`  🔑  Admin em http://localhost:${PORT}/admin`);
  console.log(`  📦  Banco: db/leaobaio.db\n`);
});

module.exports = app;
