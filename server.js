// ============================================================
//  LEÃO BAIO — Servidor Principal
//  Express + Turso (libsql) + Cloudinary
// ============================================================
require('dotenv').config();

const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const multer     = require('multer');
const path       = require('path');
const cloudinary = require('cloudinary').v2;
const { createClient } = require('@libsql/client');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Cloudinary ───────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Turso ────────────────────────────────────────────────────
const db = createClient({
  url:       process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── Multer — memória (sem disco local) ───────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_, file, cb) => {
    cb(null, /image\/(jpeg|jpg|png|webp|gif)/.test(file.mimetype));
  },
});

// ── Helper: upload buffer → Cloudinary ───────────────────────
function uploadToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder: 'leaobaio', resource_type: 'image', ...options },
        (err, result) => (err ? reject(err) : resolve(result))
      )
      .end(buffer);
  });
}

// ── Atalhos de banco ─────────────────────────────────────────
const q  = (sql, args = []) => db.execute({ sql, args });
const qa = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const q1 = async (sql, args = []) =>
  (await db.execute({ sql, args })).rows[0] ?? null;

// ── Config / auth helpers ────────────────────────────────────
async function getSetting(key) {
  const row = await q1('SELECT value FROM settings WHERE key=?', [key]);
  return row?.value ?? null;
}
async function setSetting(key, value) {
  await q('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', [key, value]);
}
function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Não autenticado.' });
}

// ════════════════════════════════════════════════════════════
//  INIT DB
// ════════════════════════════════════════════════════════════
async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      gender     TEXT    NOT NULL DEFAULT 'Unissex',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id    INTEGER NOT NULL,
      name           TEXT    NOT NULL,
      description    TEXT    DEFAULT '',
      price          REAL    NOT NULL DEFAULT 0,
      price_original REAL    DEFAULT 0,
      badge          TEXT    DEFAULT '',
      sizes          TEXT    DEFAULT '[]',
      active         INTEGER DEFAULT 1,
      sort_order     INTEGER DEFAULT 0,
      created_at     TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_images (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id     INTEGER NOT NULL,
      filename       TEXT    NOT NULL,
      cloudinary_id  TEXT    DEFAULT '',
      sort_order     INTEGER DEFAULT 0,
      created_at     TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Configurações padrão (só insere se não existir)
  const defaults = {
    admin_password:      'leaobaio123',
    store_name:          'Leão Baio',
    hero_title:          'MODA PREMIUM',
    hero_subtitle:       'Estilo que ruge · Qualidade que impõe',
    hero_badge:          '✦ Nova Coleção 2026 ✦',
    announcement:        '✦ FRETE GRÁTIS ACIMA DE R$299 · COLEÇÃO NOVA DISPONÍVEL · DESCONTO DE ATÉ 40% ✦',
    whatsapp:            '(55) 99719-6038',
    email:               'contato@leaobaio.com.br',
    free_shipping_above: '299',
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', [k, v]);
  }

  // Seed de categorias (só se banco vazio)
  const countRow = await q1('SELECT COUNT(*) as n FROM categories');
  if (Number(countRow?.n ?? 0) === 0) {
    const cats = [
      ['Camisetas Masculinas', 'Masculino',  0],
      ['Polos Masculinas',     'Masculino',  1],
      ['Jaquetas',             'Masculino',  2],
      ['Camisetas Femininas',  'Feminino',   3],
      ['Shorts',               'Masculino',  4],
      ['Acessórios',           'Acessórios', 5],
    ];
    for (const [name, gender, order] of cats) {
      await q('INSERT INTO categories(name,gender,sort_order) VALUES(?,?,?)', [name, gender, order]);
    }
    const cat = await q1("SELECT id FROM categories WHERE name='Camisetas Masculinas'");
    if (cat) {
      await q(
        `INSERT INTO products
           (category_id,name,description,price,price_original,badge,sizes,sort_order)
         VALUES(?,?,?,?,?,?,?,?)`,
        [
          Number(cat.id),
          'Camiseta Leão Signature',
          'Camiseta premium com estampa exclusiva Leão Baio.',
          89.90, 129.90, 'NOVO',
          JSON.stringify(['P', 'M', 'G', 'GG', 'XGG']),
          0,
        ]
      );
    }
  }

  console.log('  ✅  Banco Turso pronto');
}

// ── Middlewares ──────────────────────────────────────────────
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/public', express.static('public'));
app.use(
  session({
    secret:            process.env.SESSION_SECRET || 'leaobaio_secret_2026',
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 24 * 60 * 60 * 1000 },
  })
);

// ════════════════════════════════════════════════════════════
//  API PÚBLICA — loja
// ════════════════════════════════════════════════════════════

app.get('/api/store', async (req, res) => {
  try {
    const settingRows = await qa('SELECT key,value FROM settings');
    const settings = Object.fromEntries(settingRows.map(r => [r.key, r.value]));

    const categories = await qa('SELECT * FROM categories ORDER BY sort_order, id');

    const productRows = await qa(`
      SELECT p.*,
        (SELECT filename FROM product_images
         WHERE product_id=p.id ORDER BY sort_order LIMIT 1) as cover
      FROM products p
      WHERE p.active=1
      ORDER BY p.sort_order, p.id
    `);
    const products = productRows.map(p => ({ ...p, sizes: JSON.parse(p.sizes || '[]') }));

    const images = await qa(
      'SELECT id, product_id, filename, sort_order FROM product_images ORDER BY product_id, sort_order'
    );

    res.json({ settings, categories, products, images });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.get('/api/product/:id', async (req, res) => {
  try {
    const p = await q1('SELECT * FROM products WHERE id=? AND active=1', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Produto não encontrado.' });
    p.sizes  = JSON.parse(p.sizes || '[]');
    p.images = await qa(
      'SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order', [p.id]
    );
    const cat = await q1('SELECT * FROM categories WHERE id=?', [p.category_id]);
    res.json({ ...p, category: cat });
  } catch (e) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════

app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;
  const stored = await getSetting('admin_password');
  if (password === stored) {
    req.session.admin = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Senha incorreta.' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ logged: !!req.session.admin });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — CATEGORIAS
// ════════════════════════════════════════════════════════════

app.get('/api/admin/categories', requireAuth, async (req, res) => {
  try {
    const cats = await qa(`
      SELECT c.*, COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id=c.id
      GROUP BY c.id
      ORDER BY c.sort_order, c.id
    `);
    res.json(cats);
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

app.post('/api/admin/categories', requireAuth, async (req, res) => {
  const { name, gender, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  try {
    const r = await q(
      'INSERT INTO categories(name,gender,sort_order) VALUES(?,?,?)',
      [name.trim(), gender || 'Unissex', sort_order || 0]
    );
    res.json({ id: Number(r.lastInsertRowid), name, gender, sort_order });
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

app.put('/api/admin/categories/:id', requireAuth, async (req, res) => {
  const { name, gender, sort_order } = req.body;
  await q(
    'UPDATE categories SET name=?,gender=?,sort_order=? WHERE id=?',
    [name, gender, sort_order || 0, req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/admin/categories/:id', requireAuth, async (req, res) => {
  try {
    // Apagar imagens do Cloudinary de todos os produtos da categoria
    const products = await qa('SELECT id FROM products WHERE category_id=?', [req.params.id]);
    for (const p of products) {
      const images = await qa(
        'SELECT cloudinary_id FROM product_images WHERE product_id=?', [p.id]
      );
      for (const img of images) {
        if (img.cloudinary_id)
          await cloudinary.uploader.destroy(img.cloudinary_id).catch(() => {});
      }
      await q('DELETE FROM product_images WHERE product_id=?', [p.id]);
    }
    await q('DELETE FROM products WHERE category_id=?', [req.params.id]);
    await q('DELETE FROM categories WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

// ════════════════════════════════════════════════════════════
//  ADMIN — PRODUTOS
// ════════════════════════════════════════════════════════════

app.get('/api/admin/products', requireAuth, async (req, res) => {
  try {
    const rows = await qa(`
      SELECT p.*,
        c.name as category_name,
        (SELECT filename FROM product_images
         WHERE product_id=p.id ORDER BY sort_order LIMIT 1) as cover,
        (SELECT COUNT(*) FROM product_images WHERE product_id=p.id) as image_count
      FROM products p
      LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY p.sort_order, p.id DESC
    `);
    res.json(rows.map(p => ({ ...p, sizes: JSON.parse(p.sizes || '[]') })));
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

app.post('/api/admin/products', requireAuth, async (req, res) => {
  const { category_id, name, description, price, price_original, badge, sizes, sort_order } = req.body;
  if (!name || !category_id)
    return res.status(400).json({ error: 'Nome e categoria obrigatórios.' });
  try {
    const r = await q(
      `INSERT INTO products
         (category_id,name,description,price,price_original,badge,sizes,sort_order)
       VALUES(?,?,?,?,?,?,?,?)`,
      [
        category_id, name.trim(), description || '',
        parseFloat(price) || 0, parseFloat(price_original) || 0,
        badge || '', JSON.stringify(Array.isArray(sizes) ? sizes : []),
        sort_order || 0,
      ]
    );
    res.json({ id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

app.put('/api/admin/products/:id', requireAuth, async (req, res) => {
  const { category_id, name, description, price, price_original, badge, sizes, active, sort_order } = req.body;
  await q(
    `UPDATE products SET
       category_id=?, name=?, description=?, price=?, price_original=?,
       badge=?, sizes=?, active=?, sort_order=?
     WHERE id=?`,
    [
      category_id, name, description || '',
      parseFloat(price) || 0, parseFloat(price_original) || 0,
      badge || '', JSON.stringify(Array.isArray(sizes) ? sizes : []),
      active !== undefined ? active : 1,
      sort_order || 0,
      req.params.id,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    const images = await qa(
      'SELECT cloudinary_id FROM product_images WHERE product_id=?', [req.params.id]
    );
    for (const img of images) {
      if (img.cloudinary_id)
        await cloudinary.uploader.destroy(img.cloudinary_id).catch(() => {});
    }
    await q('DELETE FROM product_images WHERE product_id=?', [req.params.id]);
    await q('DELETE FROM products WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

// ════════════════════════════════════════════════════════════
//  ADMIN — IMAGENS
// ════════════════════════════════════════════════════════════

app.get('/api/admin/products/:id/images', requireAuth, async (req, res) => {
  const imgs = await qa(
    'SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order',
    [req.params.id]
  );
  res.json(imgs);
});

// Upload de imagens (múltiplas) → Cloudinary
app.post(
  '/api/admin/products/:id/images',
  requireAuth,
  upload.array('images', 50),
  async (req, res) => {
    const productId = req.params.id;
    const product = await q1('SELECT id FROM products WHERE id=?', [productId]);
    if (!product) return res.status(404).json({ error: 'Produto não encontrado.' });

    const maxRow = await q1(
      'SELECT COALESCE(MAX(sort_order),0) as m FROM product_images WHERE product_id=?',
      [productId]
    );
    const maxOrder = Number(maxRow?.m ?? 0);

    const inserted = [];
    const files = req.files || [];

    for (let i = 0; i < files.length; i++) {
      try {
        const cloudResult = await uploadToCloudinary(files[i].buffer, {
          public_id: `product_${productId}_${Date.now()}_${i}`,
        });
        const r = await q(
          'INSERT INTO product_images(product_id,filename,cloudinary_id,sort_order) VALUES(?,?,?,?)',
          [productId, cloudResult.secure_url, cloudResult.public_id, maxOrder + i + 1]
        );
        inserted.push({
          id:            Number(r.lastInsertRowid),
          filename:      cloudResult.secure_url,
          cloudinary_id: cloudResult.public_id,
          sort_order:    maxOrder + i + 1,
        });
      } catch (e) {
        console.error('Cloudinary upload error:', e.message);
      }
    }

    res.json({ uploaded: inserted.length, images: inserted });
  }
);

// Deletar imagem
app.delete('/api/admin/images/:id', requireAuth, async (req, res) => {
  const img = await q1('SELECT * FROM product_images WHERE id=?', [req.params.id]);
  if (!img) return res.status(404).json({ error: 'Imagem não encontrada.' });
  if (img.cloudinary_id)
    await cloudinary.uploader.destroy(img.cloudinary_id).catch(() => {});
  await q('DELETE FROM product_images WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// Reordenar imagens
app.put('/api/admin/images/reorder', requireAuth, async (req, res) => {
  const { order } = req.body;
  for (const { id, sort_order } of (order || [])) {
    await q('UPDATE product_images SET sort_order=? WHERE id=?', [sort_order, id]);
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  ADMIN — CONFIGURAÇÕES
// ════════════════════════════════════════════════════════════

app.get('/api/admin/settings', requireAuth, async (req, res) => {
  const rows = await qa('SELECT key,value FROM settings');
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

app.put('/api/admin/settings', requireAuth, async (req, res) => {
  const allowed = [
    'store_name', 'hero_title', 'hero_subtitle', 'hero_badge',
    'announcement', 'whatsapp', 'email', 'free_shipping_above', 'admin_password',
  ];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) await setSetting(k, v);
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  FRONTEND (SPA)
// ════════════════════════════════════════════════════════════

app.get('/',        (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ── Start ────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  🦁  LEÃO BAIO — http://localhost:${PORT}`);
      console.log(`  🔑  Admin em http://localhost:${PORT}/admin`);
      console.log(`  ☁️   Turso + Cloudinary — sem disco local\n`);
    });
  })
  .catch(err => {
    console.error('Falha ao inicializar banco:', err);
    process.exit(1);
  });

module.exports = app;
