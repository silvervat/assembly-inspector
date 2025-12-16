# 🔐 GitHub Secrets ja CI/CD Setup

## 📋 Vajalikud Secrets

Mine GitHub'is: **Repository → Settings → Secrets and variables → Actions**

### 1️⃣ Supabase Secrets (KOHUSTUSLIK)

| Secret Name | Kust saada | Näide |
|------------|-----------|-------|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → Project API keys → anon public | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |

### 2️⃣ Vercel Deployment Secrets (Kui kasutad Vercel'i)

| Secret Name | Kust saada |
|------------|-----------|
| `VERCEL_TOKEN` | Vercel → Settings → Tokens → Create Token |
| `VERCEL_ORG_ID` | Vercel → Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | Vercel → Project Settings → General → Project ID |

#### Vercel Token loomine:
1. Mine https://vercel.com/account/tokens
2. Vajuta "Create Token"
3. Anna nimi: `GitHub Actions`
4. Scope: `Full Account`
5. Kopeeri token → Lisa GitHub Secrets'i

#### Vercel IDs leidmine:
```bash
# Paigalda Vercel CLI
npm i -g vercel

# Login
vercel login

# Link projekt
vercel link

# Kuva IDs
cat .vercel/project.json
```

### 3️⃣ Netlify Deployment Secrets (Alternatiiv)

| Secret Name | Kust saada |
|------------|-----------|
| `NETLIFY_AUTH_TOKEN` | Netlify → User Settings → Applications → Personal access tokens |
| `NETLIFY_SITE_ID` | Netlify → Site settings → General → Site details → Site ID |

### 4️⃣ GitHub Pages (Kui kasutad GitHub Pages)

Ei vaja täiendavaid secrets'e - `GITHUB_TOKEN` on automaatselt saadaval.

---

## 🚀 Deployment Variandid

### VARIANT 1: Vercel (SOOVITATAV)

**Plussid:**
- ✅ Kiire deployment
- ✅ Automaatne SSL
- ✅ Global CDN
- ✅ Preview deployments

**Setup:**
1. Loo Vercel konto: https://vercel.com
2. Import GitHub repo Vercel'i
3. Lisa environment variables Vercel'is:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Lisa GitHub Secrets (vt üleval)
5. Push to `main` → automaatne deployment! 🚀

**Vercel CLI alternatiiv:**
```bash
# Install
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Set env vars
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
```

---

### VARIANT 2: Netlify

**Setup:**
1. Loo Netlify konto: https://netlify.com
2. Uncommenti Netlify deployment step `.github/workflows/deploy.yml` failis
3. Lisa GitHub Secrets (vt üleval)
4. Push to `main` → deployment!

```yaml
# Uncomment in deploy.yml:
- name: 🚀 Deploy to Netlify
  uses: nwtgck/actions-netlify@v2
  with:
    publish-dir: './dist'
    production-branch: main
  env:
    NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
    NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

---

### VARIANT 3: GitHub Pages

**Setup:**
1. Mine GitHub → Settings → Pages
2. Source: `GitHub Actions`
3. Uncommenti GitHub Pages deployment `.github/workflows/deploy.yml` failis
4. Push to `main` → deployment!

**TÄHTIS:** Lisa `vite.config.ts` faili:
```typescript
export default defineConfig({
  base: '/assembly-inspector/',  // Repo nimi
  plugins: [react()],
})
```

**URL:** `https://username.github.io/assembly-inspector/`

---

## 🔧 Secrets lisamine GitHub'i

### Visuaalne juhend:

```
1. Mine oma repo GitHub'is
2. Settings (ülemine tab)
3. Vasakult menüüst: Secrets and variables → Actions
4. Vajuta: New repository secret
5. Name: VITE_SUPABASE_URL
6. Secret: https://your-project.supabase.co
7. Add secret
8. Korda iga secret'i jaoks!
```

### Command-line (GitHub CLI):

```bash
# Paigalda gh CLI
# https://cli.github.com/

# Login
gh auth login

# Lisa secrets
gh secret set VITE_SUPABASE_URL -b "https://your-project.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY -b "your-anon-key"

# Vercel (kui kasutad)
gh secret set VERCEL_TOKEN -b "your-vercel-token"
gh secret set VERCEL_ORG_ID -b "your-org-id"
gh secret set VERCEL_PROJECT_ID -b "your-project-id"

# Kontrolli
gh secret list
```

---

## ✅ Kontroll

Pärast secrets'i lisamist:

```bash
# 1. Push kood
git add .
git commit -m "Setup CI/CD"
git push origin main

# 2. Vaata Actions tabi GitHub'is
# 3. Peaks näitama rohelist ✅

# 4. Test deployment URL'i
# Vercel: https://assembly-inspector.vercel.app
# Netlify: https://assembly-inspector.netlify.app
# GitHub Pages: https://username.github.io/assembly-inspector/
```

---

## 🔒 Turvalisus

### ⚠️ OLULINE:

- ❌ **EI TOHI** panna secrets'e koodi sisse
- ❌ **EI TOHI** commitida `.env` faili
- ✅ Kasuta ainult GitHub Secrets'e
- ✅ `.env` on `.gitignore` failis

### Secrets'i rotatsioon:

```bash
# 1. Genereeri uued võtmed Supabase'is
# 2. Uuenda GitHub Secrets
# 3. Uuenda Vercel/Netlify env vars
# 4. Redeploy
```

---

## 🐛 Troubleshooting

### ❌ Build failed: "VITE_SUPABASE_URL is not defined"

**Lahendus:** Kontrolli et secret on õigesti lisatud:
```bash
gh secret list
# Peaks näitama:
# VITE_SUPABASE_URL
# VITE_SUPABASE_ANON_KEY
```

### ❌ Vercel deployment failed

**Lahendus:**
1. Kontrolli et kõik 3 Vercel secrets'i on olemas
2. Kontrolli et token'il on õiged õigused
3. Vaata Vercel dashboard'i error log'e

### ❌ "Unexpected token in JSON"

**Lahendus:** Secret võib sisaldada tühikuid:
```bash
# Vale:
VITE_SUPABASE_URL = https://...

# Õige:
VITE_SUPABASE_URL=https://...
```

---

## 📊 Monitooring

### GitHub Actions status badge:

Lisa `README.md` faili:

```markdown
![Deploy](https://github.com/username/assembly-inspector/workflows/Deploy%20Assembly%20Inspector/badge.svg)
```

### Deployment notifications:

Saad emaili kui deployment:
- ✅ Õnnestus
- ❌ Ebaõnnestus

---

## 🎯 Kiirkäivitamine

```bash
# 1. Loo Supabase projekt
# 2. Käivita supabase-setup.sql
# 3. Kopeeri URL ja anon key

# 4. Lisa GitHub Secrets
gh secret set VITE_SUPABASE_URL -b "https://your-project.supabase.co"
gh secret set VITE_SUPABASE_ANON_KEY -b "your-key"

# 5. Vali deployment platform (Vercel soovitatav)
# 6. Lisa vastavad secrets

# 7. Push kood
git push origin main

# 8. Vaata magic happen! ✨
```

---

Made with ❤️ for seamless deployments
