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
    if (!transporter) return;
    const storeName = (await getSetting('store_name')) || 'Leão Baio Store';
    const storeEmail = (await getSetting('email')) || process.env.EMAIL_USER || '';
    const whatsapp   = (await getSetting('whatsapp')) || '';
    const address    = `${customer.address || ''}, ${customer.city || ''} — CEP ${customer.cep || ''}`;

    const itemsHtml = items.map(i => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #1e1e1e">
          <span style="color:#fff;font-size:13px">${i.name}</span>
          ${i.size ? `<span style="color:#888;font-size:11px;margin-left:6px">(${i.size})</span>` : ''}
          <span style="color:#555;font-size:11px;margin-left:4px">×${i.qty||1}</span>
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #1e1e1e;text-align:right;white-space:nowrap">
          <span style="color:#D4AF37;font-weight:600">R$ ${((i.price||0)*(i.qty||1)).toFixed(2).replace('.',',')}</span>
        </td>
      </tr>`).join('');

    const whatsappSection = whatsapp
      ? `<div style="text-align:center;margin:28px 0 0">
          <a href="https://wa.me/${whatsapp.replace(/\D/g,'')}" style="display:inline-block;background:transparent;color:#888;font-family:Arial,sans-serif;font-size:12px;text-decoration:none;border:1px solid #333;padding:10px 24px;border-radius:2px">
            💬 Fale conosco no WhatsApp
          </a>
        </div>` : '';

    await transporter.sendMail({
      from:    `"${storeName}" <${process.env.EMAIL_USER}>`,
      to:      customer.email,
      subject: `✅ Pedido #${orderId} confirmado — ${storeName}`,
      html: `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080808;font-family:Georgia,serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px">
<tr><td align="center">
<table width="100%" style="max-width:580px;background:#0F0F0F;border:1px solid rgba(212,175,55,.2)">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#0A0A0A,#161616);padding:40px 48px;text-align:center;border-bottom:1px solid rgba(212,175,55,.3)">
      <div style="font-family:Georgia,serif;font-size:11px;letter-spacing:8px;color:#888;text-transform:uppercase;margin-bottom:12px">moda casual</div>
      <div style="font-family:Georgia,serif;font-size:28px;font-weight:700;letter-spacing:6px;color:#D4AF37;text-transform:uppercase">🦁 ${storeName.toUpperCase()}</div>
      <div style="width:60px;height:1px;background:linear-gradient(90deg,transparent,#D4AF37,transparent);margin:16px auto 0"></div>
    </td>
  </tr>

  <!-- Status badge -->
  <tr>
    <td style="padding:32px 48px 8px;text-align:center">
      <div style="display:inline-block;background:rgba(76,175,80,.1);border:1px solid rgba(76,175,80,.3);color:#4CAF50;font-family:Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;padding:8px 24px;border-radius:2px">
        ✓ Pedido Confirmado
      </div>
    </td>
  </tr>

  <!-- Greeting -->
  <tr>
    <td style="padding:24px 48px 8px">
      <p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#fff;font-weight:400">
        Olá, <strong style="color:#D4AF37">${customer.name}</strong>
      </p>
      <p style="margin:12px 0 0;font-family:Arial,sans-serif;font-size:13px;color:#888;line-height:1.8">
        Seu pedido <strong style="color:#D4AF37">#${orderId}</strong> foi confirmado e já está sendo preparado com cuidado.
      </p>
    </td>
  </tr>

  <!-- Order items -->
  <tr>
    <td style="padding:24px 48px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #1e1e1e">
        <tr>
          <td style="padding:10px 8px 6px;font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#555;text-transform:uppercase">Produto</td>
          <td style="padding:10px 8px 6px;font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#555;text-transform:uppercase;text-align:right">Valor</td>
        </tr>
        ${itemsHtml}
        <tr>
          <td style="padding:16px 8px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;color:#555;text-transform:uppercase;border-top:1px solid #1e1e1e">Total</td>
          <td style="padding:16px 8px 0;border-top:1px solid #1e1e1e;text-align:right">
            <span style="font-family:Georgia,serif;font-size:24px;color:#D4AF37;font-weight:700">R$ ${total.toFixed(2).replace('.',',')}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Delivery info -->
  <tr>
    <td style="padding:0 48px 32px">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #1e1e1e;padding:20px">
        <tr>
          <td>
            <div style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#555;text-transform:uppercase;margin-bottom:8px">Endereço de entrega</div>
            <div style="font-family:Arial,sans-serif;font-size:13px;color:#ccc;line-height:1.6">${address}</div>
          </td>
        </tr>
      </table>
      ${whatsappSection}
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#080808;border-top:1px solid #1e1e1e;padding:24px 48px;text-align:center">
      <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:11px;color:#555">
        Dúvidas? <a href="mailto:${storeEmail}" style="color:#D4AF37;text-decoration:none">${storeEmail}</a>
      </p>
      <p style="margin:0;font-family:Arial,sans-serif;font-size:10px;color:#333;letter-spacing:1px">
        © ${new Date().getFullYear()} ${storeName} — Todos os direitos reservados
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`,
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
    `ALTER TABLE orders   ADD COLUMN shipping_method  TEXT DEFAULT ''`,
    `ALTER TABLE orders   ADD COLUMN shipping_price   REAL DEFAULT 0`,
    `ALTER TABLE orders   ADD COLUMN tracking_code    TEXT DEFAULT ''`,
    `ALTER TABLE orders   ADD COLUMN tracking_updated TEXT DEFAULT NULL`,
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
//  E-MAIL: NOTIFICAÇÃO DE ENVIO
// ════════════════════════════════════════════════════════════

async function sendShippingNotification(order, items, trackingCode) {
  if (!transporter) return;
  const storeName = (await getSetting('store_name')) || 'Leão Baio Store';
  const storeEmail = (await getSetting('email')) || process.env.EMAIL_USER;
  const trackUrl  = trackingCode
    ? `https://rastreamento.correios.com.br/app/index.php?objetos=${trackingCode}`
    : null;

  const itemsHtml = items.map(i =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #222;color:#fff">${i.name}${i.size ? ` (${i.size})` : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #222;color:#999;text-align:center">×${i.qty||1}</td>
      <td style="padding:8px;border-bottom:1px solid #222;color:#D4AF37;text-align:right">R$ ${((i.price||0)*(i.qty||1)).toFixed(2).replace('.',',')}</td>
    </tr>`
  ).join('');

  const trackSection = trackUrl
    ? `<div style="text-align:center;margin:24px 0">
        <a href="${trackUrl}" style="background:linear-gradient(135deg,#8A6A20,#E8C96A);color:#000;padding:14px 32px;text-decoration:none;font-weight:700;font-family:serif;letter-spacing:2px;font-size:12px;display:inline-block">
          RASTREAR PEDIDO
        </a>
        <p style="color:#999;font-size:12px;margin-top:12px">Código: <strong style="color:#D4AF37">${trackingCode}</strong></p>
      </div>`
    : `<p style="color:#999;text-align:center;font-size:13px">O código de rastreio será disponibilizado em breve.</p>`;

  await transporter.sendMail({
    from:    `"${storeName}" <${process.env.EMAIL_USER}>`,
    to:      order.customer_email,
    subject: `📦 Seu pedido #${order.id} foi enviado! — ${storeName}`,
    html: `
<div style="background:#0A0A0A;color:#fff;font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:0">
  <div style="background:#111;border-bottom:1px solid #D4AF37;padding:32px;text-align:center">
    <h1 style="font-family:Georgia,serif;color:#D4AF37;letter-spacing:4px;margin:0;font-size:22px">🦁 ${storeName}</h1>
  </div>
  <div style="padding:40px 32px">
    <h2 style="color:#D4AF37;font-family:Georgia,serif;letter-spacing:2px;font-size:18px;margin:0 0 8px">Pedido enviado! 🚀</h2>
    <p style="color:#ccc;margin:0 0 24px">Olá, <strong style="color:#fff">${order.customer_name}</strong>! Seu pedido <strong style="color:#D4AF37">#${order.id}</strong> saiu para entrega.</p>
    ${trackSection}
    <table style="width:100%;border-collapse:collapse;margin:24px 0">${itemsHtml}</table>
    <p style="color:#999;font-size:12px;margin:24px 0 0">Endereço de entrega: <span style="color:#ccc">${order.customer_address}</span></p>
  </div>
  <div style="background:#111;border-top:1px solid #222;padding:24px;text-align:center">
    <p style="color:#555;font-size:11px;margin:0">Dúvidas? Fale conosco: <a href="mailto:${storeEmail}" style="color:#D4AF37">${storeEmail}</a></p>
  </div>
</div>`,
  });
}

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

app.put('/api/admin/orders/:id', requireAuth, async (req, res) => {
  const { status, tracking_code } = req.body;
  const allowed = ['paid', 'preparing', 'shipped', 'delivered', 'cancelled'];
  if (status && !allowed.includes(status))
    return res.status(400).json({ error: 'Status inválido.' });
  try {
    const order = await q1('SELECT * FROM orders WHERE id=?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

    const updates = {};
    if (status)        updates.status = status;
    if (tracking_code !== undefined) {
      updates.tracking_code    = tracking_code;
      updates.tracking_updated = new Date().toISOString();
    }
    if (!Object.keys(updates).length) return res.json({ ok: true });

    const fields = Object.keys(updates).map(k => `${k}=?`).join(', ');
    await q(`UPDATE orders SET ${fields} WHERE id=?`, [...Object.values(updates), req.params.id]);

    // Disparar e-mail ao cliente quando pedido for marcado como enviado
    if (status === 'shipped' && order.customer_email) {
      const items = JSON.parse(order.items_json || '[]');
      const trackCode = tracking_code || order.tracking_code || '';
      await sendShippingNotification(order, items, trackCode).catch(e =>
        console.error('[E-mail envio]', e.message)
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Order update error:', e.message);
    res.status(500).json({ error: 'Erro ao atualizar pedido.' });
  }
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

// ── robots.txt ──────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml`);
});

// ── sitemap.xml ──────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const products = await qa('SELECT id, name, updated_at FROM products WHERE active=1');
    const now = new Date().toISOString().split('T')[0];
    const urls = [
      `<url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority><lastmod>${now}</lastmod></url>`,
      ...products.map(p =>
        `<url><loc>${SITE_URL}/produto/${p.id}</loc><changefreq>weekly</changefreq><priority>0.8</priority><lastmod>${now}</lastmod></url>`
      ),
    ];
    res.setHeader('Content-Type', 'application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`);
  } catch (e) {
    res.status(500).send('Erro ao gerar sitemap.');
  }
});

// ── Exportar pedidos CSV ─────────────────────────────────────
app.get('/api/admin/orders/export', requireAuth, async (req, res) => {
  try {
    const orders = await qa('SELECT * FROM orders ORDER BY created_at DESC');
    const header = ['ID','Nome','Email','Telefone','Endereço','Total','Frete','Método Frete','Rastreio','Status','Data'];
    const rows = orders.map(o => [
      o.id,
      `"${(o.customer_name||'').replace(/"/g,'""')}"`,
      `"${(o.customer_email||'').replace(/"/g,'""')}"`,
      `"${(o.customer_phone||'').replace(/"/g,'""')}"`,
      `"${(o.customer_address||'').replace(/"/g,'""')}"`,
      (o.total||0).toFixed(2).replace('.',','),
      (o.shipping_price||0).toFixed(2).replace('.',','),
      `"${(o.shipping_method||'').replace(/"/g,'""')}"`,
      `"${(o.tracking_code||'').replace(/"/g,'""')}"`,
      o.status||'',
      o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR') : '',
    ].join(';'));
    const csv = [header.join(';'), ...rows].join('
');
    const filename = `pedidos-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM para Excel abrir com acentos
  } catch (e) {
    res.status(500).json({ error: 'Erro ao exportar.' });
  }
});

// ── Política de Privacidade ──────────────────────────────────
app.get('/privacidade', async (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const storeName = (await getSetting('store_name')) || 'Leão Baio Store';
    const storeEmail = (await getSetting('email')) || '';
    res.setHeader('Content-Type', 'text/html');
    res.send(injectMeta(html, {
      title: `Política de Privacidade — ${storeName}`,
      description: `Saiba como a ${storeName} coleta, usa e protege seus dados pessoais, em conformidade com a LGPD.`,
      canonical: `${SITE_URL}/privacidade`,
      ogType: 'website',
      schema: '{}',
    }));
  } catch (e) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ── Termos de Uso ────────────────────────────────────────────
app.get('/termos', async (req, res) => {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const storeName = (await getSetting('store_name')) || 'Leão Baio Store';
    res.setHeader('Content-Type', 'text/html');
    res.send(injectMeta(html, {
      title: `Termos de Uso — ${storeName}`,
      description: `Leia os termos e condições de uso da ${storeName} antes de realizar sua compra.`,
      canonical: `${SITE_URL}/termos`,
      ogType: 'website',
      schema: '{}',
    }));
  } catch (e) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

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
