# 🦁 Leão Baio — Loja + Painel Admin Completo

Sistema completo com backend Node.js + frontend da loja + painel administrativo.
Banco de dados SQLite embutido, sem dependências externas.

---

## 📁 Estrutura

```
leaobaio-full/
├── server.js          # Backend Express + SQLite + API
├── public/
│   ├── index.html     # Frontend da loja (consome a API)
│   └── admin.html     # Painel administrativo
├── uploads/           # Fotos dos produtos (gerado automaticamente)
├── db/
│   └── leaobaio.db    # Banco de dados SQLite (gerado automaticamente)
├── .env.example
├── render.yaml        # Config de deploy no Render
└── package.json
```

---

## 🚀 Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Copiar .env
cp .env.example .env

# 3. Rodar
npm run dev        # com hot-reload (nodemon)
# ou
npm start          # produção
```

Pronto! Acesse:
- **Loja:** http://localhost:3000
- **Admin:** http://localhost:3000/admin
- **Senha padrão:** `leaobaio123`

---

## 🌐 Deploy no Render (passo a passo)

### 1. Subir para o GitHub
```bash
git init
git add .
git commit -m "feat: leao baio store completo"
git remote add origin https://github.com/SEU_USER/leaobaio-full.git
git push -u origin main
```

### 2. Criar Web Service no Render
1. Acesse [render.com](https://render.com) → **New +** → **Web Service**
2. Conecte o repositório GitHub
3. Configurações:
   - **Name:** `leaobaio-store`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`

### 3. Adicionar Disco (IMPORTANTE para persistência)
No painel do serviço → **Disks** → **Add Disk**:
- **Mount Path:** `/opt/render/project/src`
- **Size:** 1 GB (plano gratuito suporta)

> ⚠️ **Sem o disco, os dados (banco e imagens) se perdem ao reiniciar!**

### 4. Variáveis de Ambiente
No painel → **Environment** → adicione:
```
SESSION_SECRET = qualquer_string_aleatoria_longa_aqui
NODE_ENV       = production
```

### 5. Deploy
Clique em **Deploy** e aguarde ~2 minutos. Seu site estará em:
`https://leaobaio-store.onrender.com`

---

## 🔑 Painel Admin

Acesse: `https://seu-site.onrender.com/admin`

### O que você pode fazer:

**📁 Categorias**
- Criar categorias com nome e segmento (Masculino, Feminino, Acessórios, etc.)
- Definir ordem de exibição
- Excluir categorias (remove produtos junto)

**👕 Produtos**
- Criar produtos com: nome, descrição, preço, preço original (para % de desconto), badge
- Selecionar ou criar tamanhos (P, M, G, GG, XGG... ou qualquer tamanho personalizado)
- Ativar/desativar produto sem excluir
- Ordem de exibição customizável

**📸 Fotos**
- Upload de fotos ilimitadas por produto
- Suporte a arrastar e soltar
- Visualização em grade
- Exclusão individual de fotos
- A primeira foto vira a capa do produto automaticamente

**⚙️ Configurações**
- Nome da loja
- Barra de anúncio
- Título e subtítulo da hero
- WhatsApp e e-mail de contato
- Valor mínimo para frete grátis
- Alterar senha de acesso

---

## 🔧 Alterar Senha Padrão

**Opção 1** — Pelo painel admin:
`Admin → Configurações → Segurança → Nova Senha`

**Opção 2** — Direto no banco (SQLite):
```bash
sqlite3 db/leaobaio.db "UPDATE settings SET value='sua_nova_senha' WHERE key='admin_password';"
```

---

## 📞 Suporte
WhatsApp: (55) 99719-6038
