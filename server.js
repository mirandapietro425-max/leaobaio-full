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
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;
const nodemailer = require('nodemailer');
const { createClient } = require('@libsql/client');
const fs = require('fs');

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

function getMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendOrderConfirmation(customer, items, total, orderId) {
  try {
    const transporter = getMailTransporter();
    const itemsHtml = items.map(i =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #333;color:#ccc">${i.name}${i.size ? ' - ' + i.size : ''} x${i.qty}</td>
        <td style="padding:8px;border-bottom:1px solid #333;color:#D4AF37;text-align:right">R$ ${(i.price * i.qty).toFixed(2).replace('.', ',')}</td>
      </tr>`
    ).join('');
    await transporter.sendMail({
      from: `"Leao Baio Store" <${process.env.EMAIL_USER}>`,
      to: customer.email,
      subject: `Pedido #${orderId} Confirmado - Leao Baio`,
      html: `<div style="background:#0A0A0A;color:#fff;font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:40px">
        <h1 style="color:#D4AF37;text-align:center;letter-spacing:4px">LEAO BAIO</h1>
        <h2 style="color:#D4AF37">Pedido #${orderId} Confirmado!</h2>
        <p>Ola, ${customer.name}! Seu pedido foi confirmado com sucesso.</p>
        <table style="width:100%;border-collapse:collapse">${itemsHtml}
          <tr><td style="padding:12px 8px;color:#888">TOTAL</td>
          <td style="padding:12px 8px;color:#D4AF37;font-size:18px;font-weight:bold;text-align:right">R$ ${total.toFixed(2).replace('.', ',')}</td></tr>
        </table>
        <p style="color:#ccc">Endereco: ${customer.address}, ${customer.city} - CEP ${customer.cep}</p>
        <p style="color:#888;font-size:13px">Entraremos em contato pelo WhatsApp para confirmar o envio.</p>
      </div>`,
    });
  } catch (e) {
    console.error('Email error:', e.message);
  }
}

function requireAuth(req, res, next) {
  if (req.session.admin) return next();
  res.status(401).json({ error: 'Não autenticado.' });
}

// ════════════════════════════════════════════════════════════
//  INIT DB
// ════════════════════════════════════════════════════════════
async function initDB() {
  await q(`CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    gender     TEXT    NOT NULL DEFAULT 'Unissex',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT    DEFAULT (datetime('now'))
  )`);

  await q(`CREATE TABLE IF NOT EXISTS products (
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
  )`);

  await q(`CREATE TABLE IF NOT EXISTS product_images (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id     INTEGER NOT NULL,
    filename       TEXT    NOT NULL,
    cloudinary_id  TEXT    DEFAULT '',
    sort_order     INTEGER DEFAULT 0,
    created_at     TEXT    DEFAULT (datetime('now'))
  )`);

  await q(`CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  )`);

  await q(`CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_intent_id TEXT    NOT NULL UNIQUE,
    customer_name     TEXT    NOT NULL,
    customer_email    TEXT    NOT NULL,
    customer_phone    TEXT    DEFAULT '',
    customer_address  TEXT    DEFAULT '',
    items_json        TEXT    NOT NULL,
    total             REAL    NOT NULL DEFAULT 0,
    status            TEXT    DEFAULT 'paid',
    created_at        TEXT    DEFAULT (datetime('now'))
  )`);

  // Migrações: adicionar colunas novas sem quebrar bancos já existentes
  const migrations = [
    `ALTER TABLE products ADD COLUMN weight REAL DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN length REAL DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN width  REAL DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN height REAL DEFAULT NULL`,
    `ALTER TABLE orders   ADD COLUMN shipping_method TEXT DEFAULT ''`,
    `ALTER TABLE orders   ADD COLUMN shipping_price  REAL DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { await q(sql); } catch (_) { /* coluna já existe, ignorar */ }
  }

  // Tabela de sessões persistentes
  await q(`CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expired INTEGER NOT NULL
  )`);

  // Configurações padrão (só insere se não existir)
  const defaults = {
    admin_password:      'leaobaio123',
    store_name:          'Leão Baio',
    hero_title:          'LEÃO BAIO MODA CASUAL',
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

  // Migrar senha plain-text para bcrypt (executa uma vez)
  const storedPwd = await getSetting('admin_password');
  if (storedPwd && !storedPwd.startsWith('$2')) {
    const hashed = await bcrypt.hash(storedPwd, 12);
    await q("UPDATE settings SET value=? WHERE key='admin_password'", [hashed]);
  }

  console.log('  ✅  Banco Turso pronto');
}

// ── Middlewares ──────────────────────────────────────────────
// IMPORTANTE: webhook Stripe precisa do body cru — registrar ANTES do bodyParser
app.post('/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig    = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripe)  return res.sendStatus(503);
    if (!secret) {
      console.warn('[Webhook] STRIPE_WEBHOOK_SECRET não definido — ignorando evento.');
      return res.sendStatus(200);
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error('[Webhook] Assinatura inválida:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      try {
        // Evitar duplicata
        const existing = await q1('SELECT id FROM orders WHERE payment_intent_id=?', [pi.id]);
        if (!existing) {
          const meta = pi.metadata || {};
          const items = meta.items_json ? JSON.parse(meta.items_json) : [];
          const total = (pi.amount / 100);
          const r = await q(
            `INSERT INTO orders
               (payment_intent_id,customer_name,customer_email,customer_phone,
                customer_address,items_json,total,status,shipping_method,shipping_price)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [
              pi.id,
              meta.customer_name    || '',
              meta.customer_email   || '',
              meta.customer_phone   || '',
              meta.customer_address || '',
              JSON.stringify(items),
              total,
              'paid',
              meta.shipping_method  || '',
              parseFloat(meta.shipping_price) || 0,
            ]
          );
          const orderId = Number(r.lastInsertRowid);
          // Enviar e-mail de confirmação
          if (meta.customer_email) {
            const customer = {
              name:    meta.customer_name,
              email:   meta.customer_email,
              phone:   meta.customer_phone,
              address: meta.customer_address,
            };
            await sendOrderConfirmation(customer, items, total, orderId).catch(e =>
              console.error('[Webhook] Erro ao enviar e-mail:', e.message)
            );
          }
          console.log(`[Webhook] Pedido #${orderId} criado via webhook.`);
        }
      } catch (e) {
        console.error('[Webhook] Erro ao criar pedido:', e.message);
        return res.sendStatus(500);
      }
    }

    res.sendStatus(200);
  }
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/public', express.static('public'));
// ── Turso Session Store ──────────────────────────────────────
const Store = session.Store;
class TursoSessionStore extends Store {
  async get(sid, cb) {
    try {
      const row = await q1('SELECT sess, expired FROM sessions WHERE sid=?', [sid]);
      if (!row) return cb(null, null);
      if (Date.now() > row.expired) {
        await q('DELETE FROM sessions WHERE sid=?', [sid]);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  async set(sid, sess, cb) {
    try {
      const ttl     = sess.cookie?.maxAge || 86400000;
      const expired = Date.now() + ttl;
      await q(
        `INSERT INTO sessions(sid,sess,expired) VALUES(?,?,?)
         ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expired=excluded.expired`,
        [sid, JSON.stringify(sess), expired]
      );
      cb(null);
    } catch (e) { cb(e); }
  }
  async destroy(sid, cb) {
    try { await q('DELETE FROM sessions WHERE sid=?', [sid]); cb(null); }
    catch (e) { cb(e); }
  }
  async touch(sid, sess, cb) { return this.set(sid, sess, cb); }
}
setInterval(async () => {
  try { await q('DELETE FROM sessions WHERE expired<?', [Date.now()]); } catch (_) {}
}, 60 * 60 * 1000);

app.use(
  session({
    store:             new TursoSessionStore(),
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

    res.json({ settings, categories, products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.get('/api/product/:id/images', async (req, res) => {
  try {
    const images = await qa(
      'SELECT id, product_id, filename, sort_order FROM product_images WHERE product_id=? ORDER BY sort_order',
      [req.params.id]
    );
    res.json(images);
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Tente novamente em 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  const stored = await getSetting('admin_password');
  const match  = stored?.startsWith('$2')
    ? await bcrypt.compare(password, stored)
    : password === stored;
  if (match) {
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
  const { category_id, name, description, price, price_original, badge, sizes, sort_order,
          weight, length, width, height } = req.body;
  if (!name || !category_id)
    return res.status(400).json({ error: 'Nome e categoria obrigatórios.' });
  try {
    const r = await q(
      `INSERT INTO products
         (category_id,name,description,price,price_original,badge,sizes,sort_order,weight,length,width,height)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        category_id, name.trim(), description || '',
        parseFloat(price) || 0, parseFloat(price_original) || 0,
        badge || '', JSON.stringify(Array.isArray(sizes) ? sizes : []),
        sort_order || 0,
        weight != null ? parseFloat(weight) : null,
        length != null ? parseFloat(length) : null,
        width  != null ? parseFloat(width)  : null,
        height != null ? parseFloat(height) : null,
      ]
    );
    res.json({ id: Number(r.lastInsertRowid) });
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

app.put('/api/admin/products/:id', requireAuth, async (req, res) => {
  const { category_id, name, description, price, price_original, badge, sizes, active, sort_order,
          weight, length, width, height } = req.body;
  await q(
    `UPDATE products SET
       category_id=?, name=?, description=?, price=?, price_original=?,
       badge=?, sizes=?, active=?, sort_order=?,
       weight=?, length=?, width=?, height=?
     WHERE id=?`,
    [
      category_id, name, description || '',
      parseFloat(price) || 0, parseFloat(price_original) || 0,
      badge || '', JSON.stringify(Array.isArray(sizes) ? sizes : []),
      active !== undefined ? active : 1,
      sort_order || 0,
      weight != null ? parseFloat(weight) : null,
      length != null ? parseFloat(length) : null,
      width  != null ? parseFloat(width)  : null,
      height != null ? parseFloat(height) : null,
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
    'cep_origem', 'correios_usuario',
  ];
  for (let [k, v] of Object.entries(req.body)) {
    if (!allowed.includes(k)) continue;
    if (k === 'admin_password' && v && v.length >= 6) {
      v = await bcrypt.hash(v, 12);
    }
    await setSetting(k, v);
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
//  CHECKOUT - STRIPE
// ════════════════════════════════════════════════════════════

app.post('/api/checkout/create-payment-intent', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Pagamentos não configurados. Entre em contato via WhatsApp.' });
  try {
    const { items, customer } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'Carrinho vazio.' });

    // ✅ Validação de preços no servidor — nunca confie no cliente
    let total = 0;
    for (const item of items) {
      const dbProduct = await q1('SELECT price FROM products WHERE id=? AND active=1', [item.id]);
      if (!dbProduct) return res.status(400).json({ error: `Produto #${item.id} não encontrado.` });
      total += dbProduct.price * (item.qty || 1);
    }

    const amountCents = Math.round(total * 100);
    if (amountCents < 50) return res.status(400).json({ error: 'Valor minimo: R$ 0,50' });
    const address = customer
      ? `${customer.address || ''}, ${customer.city || ''} - CEP ${customer.cep || ''}`.trim()
      : '';
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'brl',
      metadata: {
        customer_name:    customer?.name    || '',
        customer_email:   customer?.email   || '',
        customer_phone:   customer?.phone   || '',
        customer_address: address,
        items_json:       JSON.stringify(items.map(i => ({
          id: i.id, name: i.name, price: i.price, qty: i.qty || 1, size: i.size || null
        }))),
        shipping_method:  customer?.shippingMethod  || '',
        shipping_price:   String(customer?.shippingPrice || 0),
      },
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (e) {
    console.error('Stripe error:', e.message);
    res.status(500).json({ error: 'Erro ao processar pagamento.' });
  }
});

app.post('/api/checkout/confirm', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Pagamentos não configurados.' });
  try {
    const { paymentIntentId, items, customer, total, shippingMethod, shippingPrice } = req.body;

    // ✅ Evitar pedido duplicado
    const existing = await q1('SELECT id FROM orders WHERE payment_intent_id=?', [paymentIntentId]);
    if (existing) return res.json({ ok: true, orderId: Number(existing.id) });
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') return res.status(400).json({ error: 'Pagamento nao confirmado.' });
    const r = await q(
      `INSERT INTO orders (payment_intent_id,customer_name,customer_email,customer_phone,customer_address,items_json,total,status,shipping_method,shipping_price) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [paymentIntentId, customer.name, customer.email, customer.phone || '',
       `${customer.address}, ${customer.city} - CEP ${customer.cep}`,
       JSON.stringify(items), total, 'paid',
       shippingMethod || '', parseFloat(shippingPrice) || 0]
    );
    const orderId = Number(r.lastInsertRowid);
    await sendOrderConfirmation(customer, items, total, orderId);
    res.json({ ok: true, orderId });
  } catch (e) {
    console.error('Confirm error:', e.message);
    res.status(500).json({ error: 'Erro ao confirmar pedido.' });
  }
});

app.get('/api/admin/orders', requireAuth, async (req, res) => {
  try {
    const orders = await qa('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
    res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items_json || '[]') })));
  } catch (e) { res.status(500).json({ error: 'Erro.' }); }
});

// ════════════════════════════════════════════════════════════
//  FRONTEND (SPA)
// ════════════════════════════════════════════════════════════

// ── Helpers de SEO ───────────────────────────────────────────
const SITE_URL = process.env.SITE_URL || 'https://leaobaio-store.onrender.com';

function buildSchema(type, data) {
  if (type === 'store') {
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ClothingStore",
      "name": "Leão Baio Store",
      "url": SITE_URL,
      "description": "Moda casual com estilo e exclusividade.",
      "currenciesAccepted": "BRL",
      "paymentAccepted": "Cartão de crédito, débito",
      "priceRange": "$$",
      "image": `${SITE_URL}/og-image.jpg`,
    });
  }
  if (type === 'product') {
    const p = data;
    return JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      "name": p.name,
      "description": p.description || '',
      "image": p.cover || `${SITE_URL}/og-image.jpg`,
      "brand": { "@type": "Brand", "name": "Leão Baio" },
      "offers": {
        "@type": "Offer",
        "url": `${SITE_URL}/produto/${p.slug || p.id}`,
        "priceCurrency": "BRL",
        "price": p.price.toFixed(2),
        "availability": p.active ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        "seller": { "@type": "Organization", "name": "Leão Baio Store" },
      },
    });
  }
  return '{}';
}

function injectMeta(html, { title, description, canonical, ogType, ogImage, schema }) {
  return html
    .replace(/META_TITLE/g,       title)
    .replace(/META_DESCRIPTION/g, description)
    .replace(/META_CANONICAL/g,   canonical)
    .replace(/META_OG_TYPE/g,     ogType || 'website')
    .replace(/META_OG_IMAGE/g,    ogImage || `${SITE_URL}/og-image.jpg`)
    .replace(/META_SCHEMA/g,      schema)
    .replace('STRIPE_PUBLISHABLE_KEY_PLACEHOLDER', process.env.STRIPE_PUBLISHABLE_KEY || '');
}

app.get('/', async (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const settings = Object.fromEntries(
      (await qa('SELECT key,value FROM settings')).map(r => [r.key, r.value])
    );
    const storeName = settings.store_name || 'Leão Baio Store';
    res.setHeader('Content-Type', 'text/html');
    res.send(injectMeta(html, {
      title:       `${storeName} | Moda Casual com Estilo`,
      description: `${storeName} — ${settings.hero_subtitle || 'Estilo, qualidade e exclusividade em cada peça.'}`,
      canonical:   SITE_URL + '/',
      ogType:      'website',
      schema:      buildSchema('store'),
    }));
  } catch (e) {
    console.error(e);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Rota de produto com meta tags dinâmicas (SEO + compartilhamento)
app.get('/produto/:id', async (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const p = await q1('SELECT * FROM products WHERE id=? AND active=1', [req.params.id]);
    if (!p) return res.redirect('/');
    const cover = await q1(
      'SELECT filename FROM product_images WHERE product_id=? ORDER BY sort_order LIMIT 1', [p.id]
    );
    p.cover = cover?.filename || null;
    const desc = p.description
      ? p.description.slice(0, 155) + (p.description.length > 155 ? '...' : '')
      : `${p.name} — R$ ${p.price.toFixed(2).replace('.', ',')}. Compre na Leão Baio Store.`;
    res.setHeader('Content-Type', 'text/html');
    res.send(injectMeta(html, {
      title:       `${p.name} | Leão Baio Store`,
      description: desc,
      canonical:   `${SITE_URL}/produto/${p.id}`,
      ogType:      'product',
      ogImage:     p.cover || `${SITE_URL}/og-image.jpg`,
      schema:      buildSchema('product', p),
    }));
  } catch (e) {
    console.error(e);
    res.redirect('/');
  }
});

app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ── Global error handler ─────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERRO]', err.message || err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Erro interno do servidor.' });
});

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
