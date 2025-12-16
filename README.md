# 🔍 Assembly Inspector

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR-USERNAME/assembly-inspector&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY)
[![Deploy](https://github.com/YOUR-USERNAME/assembly-inspector/workflows/Deploy%20Assembly%20Inspector/badge.svg)](https://github.com/YOUR-USERNAME/assembly-inspector/actions)

Trimble Connect extension assembly detailide kvaliteedikontrolliks PIN autentimisega.

## 🚀 Kiire Deployment (3 minutit)

### 1️⃣ Supabase Setup

```bash
# 1. Loo konto: https://supabase.com
# 2. Create new project
# 3. SQL Editor → Kopeeri supabase-setup.sql → Run
```

### 2️⃣ Deploy Vercel'i

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR-USERNAME/assembly-inspector&env=VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY)

Lisa env vars:
- `VITE_SUPABASE_URL` → Supabase Project URL
- `VITE_SUPABASE_ANON_KEY` → Supabase anon key

### 3️⃣ Paigalda Trimble Connect'i

```
Extension URL: https://your-app.vercel.app/manifest.json
```

✅ **Valmis!**

---

## 🎯 Funktsionaalsus

- ✅ Automaatne mudeli värvimine (valge → inspekteerimata, must → inspekteeritud)
- 🔐 PIN autentimine (localStorage)
- 📸 Snapshot + Supabase Storage upload
- ⚫ Automaatne must värv pärast inspekteerimist
- 🎯 `Tekla_Assembly.AssemblyCast_unit_Mark` kontroll
- ⚠️ Assembly Selection hoiatus

---

## 📖 Dokumentatsioon

- 📘 [Täielik README](README-FULL.md)
- ⚡ [Kiirjuhend](QUICKSTART.md)
- 🔐 [GitHub Secrets Setup](GITHUB-SECRETS.md)
- 💾 [SQL Setup](supabase-setup.sql)

---

## 🛠️ Lokaalne Arendus

```bash
# Install
npm install

# .env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Dev
npm run dev

# Build
npm run build
```

---

## 📊 Test Kasutajad

| PIN | Nimi | Roll |
|-----|------|------|
| 1234 | Mati Maasikas | inspector |
| 5678 | Kati Kask | inspector |
| 9999 | Admin User | admin |

⚠️ Muuda production'is!

---

## 🔧 Tech Stack

- React 18 + TypeScript
- Vite
- Supabase (DB + Storage)
- Trimble Connect API 5.0
- GitHub Actions + Vercel

---

## 👨‍💻 Autor

Silver Vatsel - Rivest OÜ  
📧 silver@rivest.ee

---

Made with ❤️ in Estonia 🇪🇪
