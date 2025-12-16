# ⚡ KIIRJUHEND - Assembly Inspector

## 🚀 Kiire alustamine (5 sammu)

### 1️⃣ Supabase seadistus (5 min)

Ava Supabase SQL Editor ja käivita:

```sql
-- Loo tabelid
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pin_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('inspector', 'admin', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assembly_mark TEXT NOT NULL,
  model_id TEXT NOT NULL,
  object_runtime_id INTEGER NOT NULL,
  inspector_id UUID REFERENCES users(id),
  inspector_name TEXT NOT NULL,
  inspected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  photo_url TEXT,
  notes TEXT,
  project_id TEXT NOT NULL,
  UNIQUE(project_id, model_id, object_runtime_id)
);

CREATE INDEX idx_inspections_project ON inspections(project_id);
CREATE INDEX idx_inspections_assembly ON inspections(assembly_mark);

-- Loo storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('inspection-photos', 'inspection-photos', true);

-- Policies
CREATE POLICY "Public Access" ON storage.objects FOR SELECT
USING ( bucket_id = 'inspection-photos' );

CREATE POLICY "Public Upload" ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'inspection-photos' );

-- Lisa test kasutajad
INSERT INTO users (pin_code, name, role) VALUES
('1234', 'Mati Maasikas', 'inspector'),
('5678', 'Kati Kask', 'inspector');
```

### 2️⃣ Paigalda projekt

```bash
npm install
```

### 3️⃣ Konfigureeri

Loo `.env` fail:

```env
VITE_SUPABASE_URL=https://SINU-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=SINU-ANON-KEY
```

Leia need:
- Supabase → Project Settings → API
- Copy **Project URL** ja **anon public key**

### 4️⃣ Käivita arendusserver

```bash
npm run dev
```

Ava: http://localhost:5173

### 5️⃣ Paigalda Trimble Connect'i

**Arenduses:**
- Manifest URL: `http://localhost:5173/manifest.json`

**Production:**
```bash
npm run build
# Upload dist/ folder oma serverisse
```

---

## 🎯 Kasutamine

1. **Ava extension** Trimble Connectis
2. **Logi sisse** PIN koodiga (1234 või 5678)
3. **Vali detail** 3D vaates (ÜKS detail korraga)
4. **Vajuta "Inspekteeri"** kui detail on õige
5. **Detail värvitakse mustaks** ✅

---

## 🔍 Troubleshooting

### ❌ "Assembly Selection ei ole sisse lülitatud"
👉 Trimble Connect → Settings → Assembly Selection → Enable

### ❌ "AssemblyCast_unit_Mark puudub"
👉 Mudel peab olema Tekla Structures'ist eksportitud
👉 Kontrolli kas modelis on Assembly informatsioon

### ❌ "Vale PIN kood"
👉 Kontrolli Supabase `users` tabelist kas PIN on õige

### ❌ Detailid ei värvi mustaks
👉 Kontrolli Supabase Storage Policies
👉 Vaata browser console'i (F12)

---

## 📊 Andmebaasi kontroll

```sql
-- Vaata kasutajaid
SELECT * FROM users;

-- Vaata inspektsioone
SELECT 
  assembly_mark,
  inspector_name,
  inspected_at
FROM inspections
ORDER BY inspected_at DESC
LIMIT 10;

-- Statistika
SELECT 
  inspector_name,
  COUNT(*) as total_inspections
FROM inspections
GROUP BY inspector_name;
```

---

## 🎨 Värviloigka

| Värv | RGB | Tähendus |
|------|-----|----------|
| ⚪ Valge | 255,255,255 | Inspekteerimata |
| ⚫ Must | 0,0,0 | Inspekteeritud |

---

## 💡 Näpunäited

✅ **Assembly Selection peab olema SISSE LÜLITATUD**
✅ **Vali AINULT ÜKS detail korraga**
✅ **Mudel peab olema Tekla mudel** (IFC ei tööta)
✅ **PIN koodid on tundlikud** (1234 ≠ 12340)

---

## 🆘 Abi

**Projekti struktuur:**
```
assembly-inspector/
├── src/
│   ├── App.tsx              # Peamine rakendus
│   ├── supabase.ts          # DB config
│   └── components/
│       ├── LoginScreen.tsx  # PIN login
│       └── InspectorScreen.tsx  # Inspekteerimine
├── manifest.json            # Extension manifest
└── package.json
```

**Logid:**
- Browser console: F12 → Console
- Supabase logs: Dashboard → Logs

---

Made with ❤️ by Silver Vatsel
