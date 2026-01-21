# 🚀 KIIRJUHEND - Kontrollkavade Süsteem v3.0

## Samm 1: Migratsioonid

Jooksuta Supabase SQL Editoris järjekorras:

```bash
# 1. Põhisüsteem
migrations/20260121_inspection_system_v3.sql

# 2. Bulk operatsioonid
migrations/20260121_bulk_operations_audit.sql

# 3. Kasutajaprofiilid
migrations/20260121_user_profiles.sql
```

## Samm 2: Storage Bucket

Loo Supabase Dashboard → Storage:
- Bucket: `inspection-signatures`
- Public: false
- File size limit: 1MB
- Allowed types: image/*

## Samm 3: Kood

Loe põhjalik juhend: `CLAUDE_CODE_INSTRUCTIONS.md`

Põhilised uued failid:
```
src/components/
├── InspectionAdminPanel.tsx      # Admin paneel
├── InspectionHistory.tsx         # Tegevuste ajalugu
├── InspectionGallery.tsx         # Piltide galerii
├── UserProfileModal.tsx          # Kasutaja profiil
├── SignaturePad.tsx              # Allkiri
├── PhotoUploader.tsx             # Piltide üleslaadija
└── BulkActionBar.tsx             # Bulk riba

src/hooks/
├── useInspectionHistory.ts
├── useBulkOperations.ts
├── useOfflineSync.ts
└── useUserProfile.ts
```

## Samm 4: Versioon

```typescript
// src/App.tsx
export const APP_VERSION = '3.0.800';

// package.json
"version": "3.0.800"
```

## Samm 5: Commit

```bash
git add -A
git commit -m "v3.0.800: Kontrollkavade süsteem v3.0"
git push origin main
```

---

## ⚠️ KRIITILISED PUNKTID

1. **Property Mappings** - ALATI kasuta `useProjectPropertyMappings`
2. **Pildid** - ALATI kompresseeri (max 1920px)
3. **Offline** - ALATI lisa queue'i kui pole online
4. **Progress** - ALATI näita pikematel operatsioonidel
5. **Audit** - ALATI logi olulised tegevused

---

## 📋 KONTROLLNIMEKIRI

- [ ] Migratsioonid jooksutatud
- [ ] Storage bucket loodud
- [ ] Komponendid loodud
- [ ] Hooks loodud
- [ ] Tüübid lisatud supabase.ts
- [ ] CSS stiilid lisatud
- [ ] Testitud mobiilis
- [ ] Testitud offline
- [ ] Build õnnestub
- [ ] Versioon uuendatud
