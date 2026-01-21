# Assembly Inspector Pro v3.0 - Kontrollkavade Süsteemi Uuendus

## 📋 ÜLEVAADE

See juhend kirjeldab Assembly Inspector'i kontrollkavade süsteemi põhjalikku uuendamist. Eesmärk on luua professionaalne kvaliteedikontrolli süsteem, mis ületab Daluxi võimalusi.

**Versioon:** 3.0.800+
**Prioriteet:** Kõrge
**Eeldatav maht:** ~15-20 faili, ~5000-8000 rida koodi

---

## 🎯 PÕHINÕUDED

### 1. Detaili Elutsükli Jälgimine
- Saabumine objektile (delivery_vehicles seosest)
- Saabumise kontroll
- Paigaldamine (installation_schedule seosest)
- Inspektsioon (kontrollpunktid)
- Ülevaatus ja kinnitamine

### 2. Audit Log
- Iga tegevus salvestatakse: kes, mida, millal, kust (IP/seade)
- Enne/pärast väärtused JSONB formaadis
- Automaatne logimine triggeritega

### 3. Bulk Operatsioonid Admin Paneelis
- Vali mitu kontrollpunkti checkbox-idega
- Kinnita/Suuna tagasi/Lükka tagasi kõik korraga
- Muuda staatust, määra ülevaataja
- Ekspordi valitud (Excel/PDF/CSV)

### 4. Tegevuste Ajalugu Iga Kontrollpunkti Juures
- Ikoonidega timeline (📦 saabumine, 🏗️ paigaldus, ✓✓ kinnitatud jne)
- Kellaaeg, kasutaja, detailid
- Avaneb 📋 ikooni vajutusel

### 5. Offline Piltide Sünkroniseerimine
- IndexedDB salvestamine
- Automaatne üleslaadimine ühenduse taastumisel
- Progress bar ja staatus indikaator
- Konfliktide lahendamine

### 6. GUID Vahetamine Mudeli Uuenemisel
- Admin saab käsitsi vahetada
- Säilitab kogu ajaloo
- Uuendab kõik seosed

### 7. Grupeeritud Kontrollpunktid
- Mitu detaili = üks kontrollpunkt
- Mudelist valides selekteeritakse kõik grupi liikmed
- Visuaalne tagasiside

### 8. Kasutajaprofiil
- Telefon, positsioon, ettevõte
- Allkirja väli (käsitsi joonistamine)
- Hammasratta ikoon peamenüüs

### 9. Piltide Galerii
- Admin/moderaator näeb kõiki pilte
- Iga pildi juures info: kes, millal, kuhu lisas
- Lightbox vaade

### 10. Performance
- Toetab tuhandeid kontrollpunkte projekti kohta
- Piltide automaatne optimeerimine (max 1920px, quality 0.8)
- Nutikas andmete laadimine (pagination, lazy load)
- Mobiilisõbralik (kitsas extension aken + telefon)

---

## 📁 FAILIDE STRUKTUUR

```
src/
├── components/
│   ├── InspectionPlanScreen.tsx      # UUENDA - lisa grupeeritud punktid
│   ├── InspectionAdminPanel.tsx      # UUS - admin paneel bulk operatsioonidega
│   ├── InspectionHistory.tsx         # UUS - tegevuste ajalugu komponent
│   ├── InspectionGallery.tsx         # UUS - piltide galerii
│   ├── UserProfileModal.tsx          # UUS - kasutaja profiili modal
│   ├── SignaturePad.tsx              # UUS - allkirja komponent
│   ├── PhotoUploader.tsx             # UUS - piltide üleslaadija progress bar'iga
│   ├── BulkActionBar.tsx             # UUS - bulk operatsioonide riba
│   ├── CheckpointCard.tsx            # UUS - kontrollpunkti kaart
│   └── MainMenu.tsx                  # UUENDA - lisa settings ikoon
│
├── utils/
│   ├── offlineQueue.ts               # UUENDA - täiustatud offline tugi
│   ├── imageUtils.ts                 # UUENDA - lisa thumbnail genereerimine
│   ├── pdfExport.ts                  # UUS - PDF eksport allkirjaga
│   └── auditLogger.ts                # UUS - audit log helper
│
├── hooks/
│   ├── useInspectionHistory.ts       # UUS - ajaloo hook
│   ├── useBulkOperations.ts          # UUS - bulk operatsioonide hook
│   ├── useOfflineSync.ts             # UUS - offline sünkroniseerimise hook
│   └── useUserProfile.ts             # UUS - kasutaja profiili hook
│
├── contexts/
│   └── UserProfileContext.tsx        # UUS - kasutaja profiili context
│
└── supabase.ts                       # UUENDA - lisa uued tüübid
```

---

## 🗄️ ANDMEBAASI MIGRATSIOONID

### Migratsioon 1: 20260121_inspection_system_v3.sql

Sisaldab:
- `element_lifecycle` tabel
- `inspection_audit_log` tabel
- `checkpoint_groups` tabel
- `offline_upload_queue` tabel
- Olemasolevate tabelite laiendused
- Triggerid audit logi jaoks
- Statistika vaated

### Migratsioon 2: 20260121_bulk_operations_audit.sql

Sisaldab:
- `bulk_actions_log` tabel
- `bulk_approve_inspections()` funktsioon
- `bulk_return_inspections()` funktsioon
- `bulk_change_status()` funktsioon
- `bulk_assign_reviewer()` funktsioon
- `get_inspection_history()` funktsioon
- `get_element_full_history()` funktsioon
- Statistika vaated

### Migratsioon 3: 20260121_user_profiles.sql (LOO UUS)

```sql
-- Kasutaja profiili laiendus
ALTER TABLE trimble_ex_users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS position TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_updated_at TIMESTAMPTZ;

-- Allkirjade storage bucket
-- NB: Loo Supabase dashboardis: inspection-signatures (public: false)
```

---

## 🎨 VÄRVIKOODID MUDELIS

```typescript
export const INSPECTION_COLORS = {
  background: { r: 255, g: 255, b: 255, a: 255 },      // Valge - muud detailid
  toBeChecked: { r: 74, g: 85, b: 104, a: 255 },       // Tumehall #4A5568
  inProgress: { r: 245, g: 158, b: 11, a: 255 },       // Kollane #F59E0B
  completed: { r: 59, g: 130, b: 246, a: 255 },        // Sinine #3B82F6
  approved: { r: 16, g: 185, b: 129, a: 255 },         // Roheline #10B981
  rejected: { r: 239, g: 68, b: 68, a: 255 },          // Punane #EF4444
  returned: { r: 249, g: 115, b: 22, a: 255 },         // Oranž #F97316
  hovered: { r: 139, g: 92, b: 246, a: 255 },          // Lilla #8B5CF6
  groupSelected: { r: 236, g: 72, b: 153, a: 255 },    // Roosa #EC4899
};
```

---

## 📱 MOBIILI JA KITSAS AKNAS TOIMIMINE

### Põhimõtted:
1. **Vertikaalne paigutus** - kõik elemendid üksteise all
2. **Suured puutetundlikud alad** - min 44px kõrgus nuppudel
3. **Progress bar'id** - iga pikema operatsiooni juures
4. **Lazy loading** - laadi andmeid vastavalt vajadusele
5. **Virtualized lists** - suurte nimekirjade jaoks

### Kaamera ja Failid:
```typescript
// Kaamera input mobiilil
<input
  type="file"
  accept="image/*"
  capture="environment"  // Tagumine kaamera
  onChange={handleFileSelect}
/>

// Progress bar üleslaadimisele
<div className="upload-progress">
  <div className="progress-bar" style={{ width: `${progress}%` }} />
  <span>{progress}% - {uploadedCount}/{totalCount}</span>
</div>
```

---

## 🔧 KOMPONENDID

### 1. InspectionAdminPanel.tsx

```typescript
interface InspectionAdminPanelProps {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  user: TrimbleExUser;
  onClose: () => void;
}

// Funktsioonid:
// - Bulk select checkbox'idega
// - Filtreerimine (staatus, kategooria, inspektor, periood)
// - Bulk approve/return/reject
// - Tegevuste ajalugu iga rea juures
// - Eksport (Excel, PDF, CSV)
// - Statistika kaardid ülaosas
```

### 2. InspectionHistory.tsx

```typescript
interface InspectionHistoryProps {
  planItemId: string;
  guid: string;
  projectId: string;
  onClose: () => void;
}

// Timeline kuvamine ikoonidega
// Kasutab get_inspection_history() funktsiooni
```

### 3. PhotoUploader.tsx

```typescript
interface PhotoUploaderProps {
  onUpload: (files: ProcessedFile[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  showProgress?: boolean;
}

interface ProcessedFile {
  file: File;
  thumbnail: string;
  originalSize: number;
  compressedSize: number;
}

// Funktsioonid:
// - Drag & drop
// - Kaamera capture (mobiil)
// - Automaatne kompressioon
// - Progress bar
// - Offline queue'i lisamine
```

### 4. UserProfileModal.tsx

```typescript
interface UserProfileModalProps {
  user: TrimbleExUser;
  onClose: () => void;
  onSave: (updates: UserProfileUpdates) => void;
}

interface UserProfileUpdates {
  phone?: string;
  position?: string;
  company?: string;
  signature_url?: string;
}

// Sisaldab:
// - Telefoni, positsiooni, ettevõtte väljad
// - SignaturePad allkirja jaoks
// - Salvesta/Tühista nupud
```

### 5. SignaturePad.tsx

```typescript
interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  existingSignature?: string;
  width?: number;
  height?: number;
}

// Canvas-põhine allkirja joonistamine
// Touch support mobiilil
```

### 6. BulkActionBar.tsx

```typescript
interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  onApprove: () => void;
  onReturn: () => void;
  onReject: () => void;
  onStatusChange: (status: string) => void;
  onAssign: (userId: string) => void;
  onExport: (format: 'excel' | 'pdf' | 'csv') => void;
  onClearSelection: () => void;
}
```

---

## 🪝 HOOKS

### useInspectionHistory.ts

```typescript
export function useInspectionHistory(planItemId: string) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function loadHistory() {
      const { data } = await supabase.rpc('get_inspection_history', {
        p_plan_item_id: planItemId
      });
      setHistory(data || []);
      setLoading(false);
    }
    loadHistory();
  }, [planItemId]);
  
  return { history, loading };
}
```

### useBulkOperations.ts

```typescript
export function useBulkOperations(projectId: string, userEmail: string) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const bulkApprove = async (ids: string[], comment?: string) => {
    setProcessing(true);
    const { data } = await supabase.rpc('bulk_approve_inspections', {
      p_plan_item_ids: ids,
      p_reviewer_email: userEmail,
      p_reviewer_name: userName,
      p_comment: comment
    });
    setProcessing(false);
    return data;
  };
  
  // bulkReturn, bulkReject, bulkChangeStatus, bulkAssign...
  
  return { bulkApprove, bulkReturn, bulkReject, processing, progress };
}
```

### useOfflineSync.ts

```typescript
export function useOfflineSync() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  // Kuula online/offline sündmusi
  // Sünkroniseeri automaatselt kui online
  // Tagasta staatus ja manual sync funktsioon
  
  return { pendingCount, syncing, isOnline, syncNow };
}
```

---

## 📤 PDF EKSPORT

### Failinimede Formaat
```
{projekt}_{inspektsioon}_{kontrollpunkt}_{kuupäev}.pdf
Näide: PRJ001_Paigalduskontroll_T-15-A_2026-01-21.pdf
```

### PDF Sisu
1. Päis: Projekt, kuupäev, inspektor
2. Detaili info: GUID, assembly mark, kategooria
3. Kontrollküsimused ja vastused
4. Pildid (thumbnail'id)
5. Kommentaarid
6. Allkiri (kasutaja profiilist)
7. Jalus: Genereeritud aeg, versioon

---

## 🔄 MUDELI INTERAKTSIOON

### Detaili Valimine Mudelis → Lista Märgistamine

```typescript
// App.tsx või InspectionPlanScreen.tsx

useEffect(() => {
  const handleSelectionChange = async () => {
    const selection = await api.viewer.getSelection();
    if (!selection?.length) return;
    
    // Leia valitud GUID-id
    const selectedGuids = await getGuidsFromSelection(api, selection);
    
    // Märgista listis
    setHighlightedGuids(new Set(selectedGuids));
    
    // Kui grupeeritud, märgista kogu grupp
    const group = await findGroupByGuid(selectedGuids[0]);
    if (group) {
      setHighlightedGuids(new Set(group.element_guids));
      // Vali mudelis ka teised grupi liikmed
      await selectGroupInModel(api, group.element_guids);
    }
  };
  
  // Poll iga 500ms (Trimble API ei toeta event listeners)
  const interval = setInterval(handleSelectionChange, 500);
  return () => clearInterval(interval);
}, [api]);
```

---

## ⚡ PERFORMANCE OPTIMEERIMINE

### Andmete Laadimine

```typescript
// Pagination
const PAGE_SIZE = 50;
const [page, setPage] = useState(0);

const { data } = await supabase
  .from('inspection_plan_items')
  .select('*')
  .eq('project_id', projectId)
  .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

// Lazy load detailid ainult kui vaja
const loadDetails = async (itemId: string) => {
  const { data } = await supabase
    .from('inspection_results')
    .select('*')
    .eq('plan_item_id', itemId);
  return data;
};
```

### Piltide Optimeerimine

```typescript
// Kompressioon enne üleslaadimist
const COMPRESS_OPTIONS = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8,
  mimeType: 'image/jpeg'
};

// Thumbnail'id listis
const THUMBNAIL_OPTIONS = {
  width: 150,
  height: 150,
  quality: 0.6
};
```

---

## 🔒 ÕIGUSTE KONTROLL

```typescript
// Kas saab muuta (completed + approved = ei saa)
const canEdit = (item: InspectionPlanItem) => {
  if (item.review_status === 'approved') return false;
  if (item.locked_at) return false;
  return item.can_edit !== false;
};

// Kas on admin/moderaator
const canReview = (user: TrimbleExUser) => {
  return user.role === 'admin' || user.role === 'moderator';
};

// Kas näeb admini paneeli
const canAccessAdminPanel = (user: TrimbleExUser) => {
  return user.can_access_admin || user.role === 'admin';
};
```

---

## 🧪 TESTIMINE

### Kontrollnimekiri Enne Commit'i

- [ ] Bulk operatsioonid töötavad 100+ kirjega
- [ ] Offline režiim salvestab ja sünkroniseerib pilte
- [ ] Ajalugu kuvatakse õigesti timeline'ina
- [ ] PDF eksport sisaldab allkirja
- [ ] Mobiilivaade on kasutatav (kitsas aken)
- [ ] Progress bar'id töötavad kõigil pikeamatel operatsioonidel
- [ ] GUID vahetus uuendab kõik seosed
- [ ] Grupeeritud kontrollpunktid valitakse koos

---

## 📝 COMMIT JUHEND

```bash
# 1. Uuenda versioon
# src/App.tsx: export const APP_VERSION = '3.0.8XX';
# package.json: "version": "3.0.8XX"

# 2. Build
npm run build

# 3. Commit
git add -A
git commit -m "v3.0.8XX: Kontrollkavade süsteem v3.0 - [kirjeldus]

- Lisa element_lifecycle tabel
- Lisa audit log süsteem
- Lisa bulk operatsioonid admin paneelis
- Lisa tegevuste ajalugu
- Lisa kasutaja profiil allkirjaga
- Lisa piltide galerii
- Täiusta offline sünkroniseerimine
- Lisa GUID vahetamine
- Lisa grupeeritud kontrollpunktid
"

# 4. Push
git push origin main
```

---

## 🚨 KRIITILISED REEGLID

1. **ALATI** kasuta `useProjectPropertyMappings` hook'i mudeli property lugemisel
2. **ALATI** kompresseeri pilte enne üleslaadimist
3. **ALATI** lisa progress bar pikemate operatsioonide juurde
4. **ALATI** kontrolli `can_edit` enne muutmist
5. **ALATI** logi audit_log tabelisse olulised tegevused
6. **KUNAGI** ära laadi kõiki andmeid korraga - kasuta pagination'it
7. **KUNAGI** ära blokeeri UI pikaajaliste operatsioonide ajal
8. **KUNAGI** ära unusta offline queue'i - kasutaja võib olla telefonis kehva ühendusega

---

## 📚 SEOTUD FAILID

- `docs/ARCHITECTURE.md` - Süsteemi arhitektuur
- `docs/DATABASE.md` - Andmebaasi skeem
- `docs/CONVENTIONS.md` - Koodireeglid
- `supabase/migrations/` - SQL migratsioonid

---

## ✅ VALMIDUSE KONTROLL

Enne deploy'i kontrolli:

1. **Andmebaas**: Kõik migratsioonid on jooksutatud
2. **Storage**: `inspection-signatures` bucket on loodud
3. **Build**: `npm run build` õnnestub vigadeta
4. **Mobiil**: Testitud telefonis (Chrome DevTools device mode)
5. **Offline**: Testitud ilma ühenduseta
6. **Bulk**: Testitud 50+ kirjega

---

*Viimati uuendatud: 21. jaanuar 2026*
*Versioon: 3.0.800*
