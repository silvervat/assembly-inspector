# ✅ Deployment Checklist

## 📋 Pre-Deployment

### Supabase
- [ ] Loo Supabase projekt
- [ ] Käivita `supabase-setup.sql` SQL Editor'is
- [ ] Kontrolli et tabelid on loodud: `users`, `inspections`
- [ ] Kontrolli et storage bucket on loodud: `inspection-photos`
- [ ] Kopeeri Project URL
- [ ] Kopeeri anon public key
- [ ] (Optional) Muuda või kustuta test kasutajad

### GitHub
- [ ] Loo GitHub repo
- [ ] Push kood GitHub'i
- [ ] Lisa GitHub Secrets:
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`

### Deployment Platform (vali üks)

#### Vercel (Soovitatav)
- [ ] Loo Vercel konto
- [ ] Import GitHub repo
- [ ] Lisa environment variables Vercel'is
- [ ] Lisa GitHub Secrets:
  - [ ] `VERCEL_TOKEN`
  - [ ] `VERCEL_ORG_ID`
  - [ ] `VERCEL_PROJECT_ID`
- [ ] Test deployment

#### Netlify
- [ ] Loo Netlify konto
- [ ] Uncommenti Netlify step `.github/workflows/deploy.yml` failis
- [ ] Lisa GitHub Secrets:
  - [ ] `NETLIFY_AUTH_TOKEN`
  - [ ] `NETLIFY_SITE_ID`

#### GitHub Pages
- [ ] Lülita GitHub Pages sisse (Settings → Pages)
- [ ] Lisa `base` path `vite.config.ts` failis
- [ ] Uncommenti GitHub Pages step workflow'is

---

## 🚀 Deployment

- [ ] Push kood to `main` branch
- [ ] Vaata GitHub Actions tab
- [ ] Kontrolli et deployment õnnestus ✅
- [ ] Ava deployment URL
- [ ] Test sisselogimine (PIN: 1234)

---

## 🔧 Trimble Connect Setup

- [ ] Ava Trimble Connect projekt
- [ ] Mine: Project Settings → Extensions
- [ ] Add Extension
- [ ] Manifest URL: `https://your-app.vercel.app/manifest.json`
- [ ] Enable extension
- [ ] Test et extension avaneb

---

## ✅ Testing

### Basic Tests
- [ ] Extension avaneb
- [ ] Mudel värvitakse valgeks
- [ ] PIN login töötab (1234)
- [ ] Kasutaja info kuvatakse
- [ ] Logout töötab

### Inspector Flow
- [ ] Vali 1 detail 3D vaates
- [ ] Assembly Mark kuvatakse
- [ ] "Inspekteeri" nupp on enabled
- [ ] Snapshot tehakse
- [ ] Pilt uploaditakse Supabase'i
- [ ] Detail värvitakse mustaks
- [ ] Andmed salvestatakse DB'sse

### Edge Cases
- [ ] Mitme detaili valimine → hoiatus
- [ ] Detailil puudub Cast Unit Mark → hoiatus
- [ ] Assembly Selection off → hoiatus
- [ ] Juba inspekteeritud detail → hoiatus
- [ ] Logout ja uuesti login → inspekteeritud detailid on mustad

---

## 📊 Production Checklist

### Security
- [ ] Muuda või kustuta test kasutajad
- [ ] Kontrolli Supabase RLS policies
- [ ] Kontrolli Storage policies
- [ ] Ära pane secrets'e koodi
- [ ] `.env` on `.gitignore` failis

### Performance
- [ ] Build size on mõistlik (<1MB)
- [ ] First load on kiire (<3s)
- [ ] Snapshot upload on kiire (<2s)

### Monitoring
- [ ] GitHub Actions badge töötab
- [ ] Vercel analytics on aktiveeritud (optional)
- [ ] Error tracking on seadistatud (optional)

---

## 📖 Documentation

- [ ] README.md on ajakohane
- [ ] GITHUB-SECRETS.md on täidetud
- [ ] Manifest URL on dokumenteeritud
- [ ] Test kasutajad on dokumenteeritud

---

## 🆘 Support

### Kui midagi ei tööta:

1. **Kontrolli GitHub Actions logi**
   - Mine GitHub → Actions tab
   - Vaata error message'it

2. **Kontrolli browser console**
   - F12 → Console
   - Vaata errors

3. **Kontrolli Supabase logs**
   - Supabase Dashboard → Logs
   - Vaata API errors

4. **Kontrolli Vercel logs**
   - Vercel Dashboard → Deployments
   - Vaata build logs

---

## 🎉 Launch!

Kui kõik checklist'is on ✅:

```bash
# Create a release
git tag -a v1.0.0 -m "Initial release"
git push origin v1.0.0

# Celebrate! 🎊
```

---

## 📞 Kontakt

**Probleemid?** Loo GitHub Issue või kirjuta:  
📧 silver@rivest.ee

---

Made with ❤️ - Assembly Inspector v1.0
