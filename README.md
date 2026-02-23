# 🦁 Leão Baio — Loja + Painel Admin

Backend Node.js com **Turso** (banco), **Cloudinary** (fotos), **Stripe** (pagamentos) e **Gmail** (e-mails de confirmação).
Deploy no **Render Free** — sem disco necessário, dados persistem na nuvem.

---

## 📁 Estrutura de Pastas

```
leaobaio-full/
├── server.js          ← backend principal (Express + todas as APIs)
├── package.json       ← dependências
├── render.yaml        ← config de deploy no Render
├── .env.example       ← modelo das variáveis (copie para .env)
├── .gitignore
├── README.md
└── public/
    ├── index.html     ← frontend da loja
    └── admin.html     ← painel administrativo
```

> ✅ **Não existem mais as pastas `db/` e `uploads/`.**
> O banco fica no Turso e as fotos no Cloudinary — ambos na nuvem, ambos gratuitos.

---

## 🔑 Serviços externos (todos gratuitos para começar)

| Serviço | Para que serve | Obrigatório? |
|---|---|---|
| **Turso** | Banco SQLite na nuvem | ✅ Sim |
| **Cloudinary** | Hospedagem das fotos | ✅ Sim |
| **Render** | Servidor Node.js online | ✅ Sim |
| **Stripe** | Pagamentos com cartão | ⚪ Opcional |
| **Gmail** | E-mail de confirmação de pedido | ⚪ Opcional |

> Sem Stripe e Gmail o site funciona normalmente — apenas o checkout e os e-mails ficam desativados.

---

## 🚀 Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Criar o .env com suas chaves reais
cp .env.example .env
# Abra o .env e preencha as variáveis do Turso e Cloudinary

# 3. Rodar
npm run dev     # desenvolvimento (reinicia automaticamente)
npm start       # produção
```

Acesse:
- **Loja:** http://localhost:3000
- **Admin:** http://localhost:3000/admin — senha padrão: `leaobaio123`

---

## 🌐 Deploy no Render

### 1. Subir para o GitHub

Abra o terminal **dentro da pasta `leaobaio-full`** e execute:

```bash
git init
git add .
git commit -m "feat: leaobaio v2 turso cloudinary"
git remote add origin https://github.com/SEU_USUARIO/leaobaio-full.git
git branch -M main
git push -u origin main
```

### 2. Criar Web Service no Render

1. Acesse [render.com](https://render.com) → **New +** → **Web Service**
2. Conecte o repositório GitHub
3. Preencha:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free

> ✅ **Não adicione disco** — os dados ficam no Turso e Cloudinary.

### 3. Adicionar as variáveis de ambiente

Painel do serviço → **Environment** → adicione as 12 variáveis:

```
NODE_ENV                = production
SESSION_SECRET          = qualquer_frase_longa_aleatoria
TURSO_DATABASE_URL      = libsql://leaobaio-db-seuusuario.turso.io
TURSO_AUTH_TOKEN        = eyJhbGci...
CLOUDINARY_CLOUD_NAME   = dxxxxx
CLOUDINARY_API_KEY      = 1234567890
CLOUDINARY_API_SECRET   = abcDEF_xxxxx
STRIPE_SECRET_KEY       = sk_live_...
STRIPE_PUBLISHABLE_KEY  = pk_live_...
EMAIL_USER              = seuemail@gmail.com
EMAIL_PASS              = senha_app_16_chars
PORT                    = 3000
```

### 4. Deploy

Clique em **Deploy** e aguarde ~2 minutos.
Seu site estará em: `https://leaobaio-store.onrender.com`

---

## 🔑 Painel Administrativo

Acesse: `https://seu-app.onrender.com/admin`

| Seção | Funcionalidade |
|---|---|
| **Dashboard** | Resumo — total de produtos, categorias e fotos |
| **Produtos** | Criar, editar, ativar/desativar, tamanhos, badge, preço |
| **Categorias** | Criar tipos de roupa por segmento (Masculino, Feminino...) |
| **Fotos** | Upload ilimitado por produto, arrastar e soltar |
| **Configurações** | Nome da loja, hero, contato, frete grátis, senha |

---

## 📦 Como atualizar o site depois de mudar o código

```bash
git add .
git commit -m "update: descrição da mudança"
git push
```
O Render detecta o push e faz deploy automático em ~1 minuto.

---

## 🔧 Trocar a senha do admin

**Pelo painel:** Admin → Configurações → Segurança → Nova Senha

---

## ⚠️ Plano gratuito do Render

O servidor "dorme" após 15 min sem acesso — a primeira visita pode demorar ~30s.
Para evitar isso, cadastre o site no [UptimeRobot](https://uptimerobot.com) (gratuito)
para fazer um ping a cada 10 minutos.

---

## 📞 Suporte
WhatsApp: (55) 99719-6038
