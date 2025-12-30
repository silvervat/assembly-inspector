# Assembly Inspector - Komponentide Hierarhia

## Ülevaade

```
App.tsx
├── MainMenu.tsx (kui screen === 'menu')
├── InspectorScreen.tsx (kui screen === 'inspector')
├── AdminScreen.tsx (kui screen === 'admin')
├── DeliveryScheduleScreen.tsx (kui screen === 'deliverySchedule')
├── InstallationScheduleScreen.tsx (kui screen === 'installationSchedule')
└── InspectionPlanScreen.tsx (kui screen === 'inspectionPlan')
```

## Kontekstid

### PropertyMappingsContext
**Fail:** `src/contexts/PropertyMappingsContext.tsx`

```typescript
// Hook kasutamiseks
const { mappings, isLoading, reload } = useProjectPropertyMappings(projectId);

// Cache tühjendamine (Admin salvestamisel)
clearMappingsCache(projectId);
```

**Funktsioonid:**
- `useProjectPropertyMappings(projectId)` - Hook mappingute laadimiseks
- `clearMappingsCache(projectId?)` - Cache tühjendamine
- `loadMappingsFromDb(projectId)` - Otse andmebaasist laadimine
- Cache invalidation listeners - automaatne uuesti laadimine

## Peamised Komponendid

### App.tsx
**Props:** -

**State:**
- `screen` - Aktiivne ekraan
- `api` - Workspace API objekt
- `projectId` - Trimble projekti ID
- `userEmail` - Kasutaja email
- `userRole` - Kasutaja roll ('admin' | 'inspector' | 'viewer')

**Funktsioonid:**
- Autentimine Trimble kasutaja järgi
- Super admin kontroll (`SUPER_ADMIN_EMAIL`)
- Navigatsioon ekraanide vahel

---

### DeliveryScheduleScreen.tsx
**Props:**
- `api` - Workspace API
- `projectId` - Projekti ID
- `onBackToMenu` - Tagasi funktsioon
- `userEmail` - Kasutaja email

**Olulised State'd:**
| State | Tüüp | Kirjeldus |
|-------|------|-----------|
| `vehicles` | `DeliveryVehicle[]` | Veokid |
| `items` | `DeliveryItem[]` | Detailid |
| `factories` | `Factory[]` | Tehased |
| `selectedItemIds` | `Set<string>` | Valitud detailide ID'd |
| `selectedObjects` | `SelectedObject[]` | Mudelist valitud objektid |
| `propertyMappings` | `PropertyMappings` | Tekla property seaded |

**Olulised Ref'd:**
| Ref | Kirjeldus |
|-----|-----------|
| `syncingToModelRef` | Lipp: kas sünkroniseerime mudelisse |
| `selectionInProgressRef` | Lipp: selection handler töötab |
| `previousModelSelectionRef` | Eelmise valiku võti (duplikaatide tuvastamine) |

**Peamised Funktsioonid:**
- `handleItemClick` - Detaili klõps (valik)
- `handleSelectionChange` - Mudeli valiku muutus
- `refreshFromModel` - Property'd mudelist uuesti
- `exportToExcel` - Excel eksport (kaalud 1 komakohaga)
- `addSelectedToVehicle` - Lisa valitud veokisse
- `naturalSortVehicleCode` - Numbriline veokikoodide sorteerimine (EBE-8, EBE-9, EBE-10)

**Veokite sorteerimine:**
```typescript
// Natural sort: EBE-8, EBE-9, EBE-10 (mitte EBE-10, EBE-8, EBE-9)
.sort((a, b) => {
  const orderDiff = (a.vehicle?.sort_order || 0) - (b.vehicle?.sort_order || 0);
  if (orderDiff !== 0) return orderDiff;
  return naturalSortVehicleCode(a.vehicle?.vehicle_code, b.vehicle?.vehicle_code);
})
```

**Checkbox Multi-Select Loogika:**
```
1. Kasutaja klõpsab checkbox → e.stopPropagation()
2. setSelectedItemIds(prev => { ...add/remove... })
3. useEffect käivitub → syncingToModelRef = true
4. selectObjectsByGuid() → mudel valitakse
5. handleSelectionChange() käivitub, AGA syncingToModelRef = true
6. → setSelectedItemIds(new Set()) EI kutsuta
7. 2000ms pärast → syncingToModelRef = false
```

---

### InstallationScheduleScreen.tsx
**Props:** Sama mis DeliveryScheduleScreen

**Erinevused DeliveryScheduleScreen'ist:**
- Kuupäeva-põhine planeerimine (mitte veokid)
- Ei kasuta checkbox'e - rea klõps valib
- Property mappings ei kasutata (loeb otse mudelist)
- Eksport: kaalud 1 komakohaga

---

### AdminScreen.tsx
**Props:**
- `api` - Workspace API
- `projectId` - Projekti ID
- `onBackToMenu` - Tagasi funktsioon
- `userEmail` - Kasutaja email

**Vaated (adminView):**
- `'main'` - Peavaade
- `'properties'` - Objekti property'd
- `'modelObjects'` - "Saada andmebaasi"
- `'propertyMappings'` - Tekla property seaded
- `'assemblyList'` - Assembly nimekiri
- `'guidImport'` - GUID import

**"Saada andmebaasi" Funktsioonid:**
| Funktsioon | Kirjeldus |
|------------|-----------|
| `saveModelSelectionToSupabase` | Valitud objektid → andmebaasi (delete + insert pattern) |
| `saveAllAssembliesToSupabase` | KÕIK mudeli objektid → andmebaasi (IFC GUID alusel) |
| `deleteAllModelObjects` | Kustuta kõik kirjed |

**Saada andmebaasi loogika:**
```
1. "Mudeli valik → Andmebaasi":
   - Loeb valitud objektide property'd (kasutab propertyMappings)
   - Kustutab sama GUID-ga vanad kirjed
   - Lisab uued kirjed
   - Näitab veateateid, kui insert ebaõnnestub

2. "KÕIK assemblyd → Andmebaasi":
   - Skaneerib KÕIK mudeli objektid
   - Kasutab `getHierarchyChildren` API-t hierarhia kontrolliks
   - Salvestab AINULT objektid, millel ON laps-objekte (vanem-assemblyd)
   - Alam-detailid (osad, poldid) jäetakse välja (neil pole lapsi)
   - Kasutab delete + insert pattern GUID unikaalsuse tagamiseks
```

**Property Mappings:**
- `loadPropertyMappings` - Laadi seaded andmebaasist
- `savePropertyMappings` - Salvesta seaded
- `scanAvailableProperties` - Skaneeri mudelist property'd

**Vigade käsitlemine:**
- Batch insert vead logitakse konsooli
- Kasutajale näidatakse veateateid status väljal
- Vea korral: `⚠️ Salvestatud X/Y objekti (Z viga - vaata konsooli)`

---

### InspectorScreen.tsx
**Funktsioonid:**
- Kvaliteedikontrolli läbiviimine
- Inspektsiooni salvestamine
- Fotode lisamine (TODO)

---

### MainMenu.tsx
**Funktsioonid:**
- Režiimi valik
- Navigatsioon teistele ekraanidele
- Kasutaja initsiaalide kuvamine

## Utiliidid

### navigationHelper.ts
```typescript
// GUID järgi objektide valimine
async function selectObjectsByGuid(
  api: WorkspaceAPI,
  guids: string[],
  mode: 'set' | 'add' | 'remove'
): Promise<number>
```

### offlineQueue.ts
```typescript
// Offline operatsioonide järjekord
function initOfflineQueue(): void
function queueOperation(operation: QueuedOperation): void
```

## Stiilid

### App.css
- Globaalsed stiilid
- `.btn-primary`, `.btn-secondary`, `.btn-danger`
- `.spin` animatsioon (loading)
- Ekraani-spetsiifilised stiilid

## Ikooni Teek
```typescript
import {
  FiArrowLeft,
  FiRefreshCw,
  FiUpload,
  FiDownload,
  FiDatabase,
  FiCheck,
  FiX,
  // ...
} from 'react-icons/fi';
```
