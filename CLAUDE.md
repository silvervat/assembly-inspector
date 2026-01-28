# Assembly Inspector - Claude Code Reeglid (LISA CLAUDE.md ALGUSESSE!)

## ā ļø¸ KRIITILISED LIMIIDID

### Failide Maksimumsuurused
| TĆ¼Ć¼p | Max ridu | Max KB | NĆ¤ide |
|------|----------|--------|-------|
| Komponent | 500 | 30 | XxxPanel.tsx |
| Hook | 200 | 15 | useXxx.ts |
| Util | 300 | 20 | xxxHelper.ts |
| Types | 400 | 25 | types/index.ts |

**REEGL:** Kui fail Ć¼letab limiiti ā†’ TĆKELDA enne muudatusi!

### Blokeeritud Failid (Liiga suured!)
```
ā¯ AdminScreen.tsx (18,657 rida) - EI MUUDA, TĆKELDA!
ā¯ OrganizerScreen.tsx (14,365 rida) - EI MUUDA, TĆKELDA!
ā¯ DeliveryScheduleScreen.tsx (12,594 rida) - EI MUUDA, TĆKELDA!
ā¯ InstallationsScreen.tsx (10,679 rida) - EI MUUDA, TĆKELDA!
ā¯ InstallationScheduleScreen.tsx (8,974 rida) - EI MUUDA, TĆKELDA!
ā¯ ArrivedDeliveriesScreen.tsx (7,701 rida) - EI MUUDA, TĆKELDA!
```

## š“ Uus Kausta Struktuur

```
src/
ā”ā”€ā”€ features/           # Feature-pĆµhine kood
ā”‚   ā”ā”€ā”€ admin/
ā”‚   ā”‚   ā”ā”€ā”€ components/  # UI komponendid
ā”‚   ā”‚   ā”ā”€ā”€ hooks/       # Custom hooks
ā”‚   ā”‚   ā”ā”€ā”€ types/       # TypeScript tĆ¼Ć¼bid
ā”‚   ā”‚   ā””ā”€ā”€ index.ts     # Re-exports
ā”‚   ā”ā”€ā”€ delivery/
ā”‚   ā”ā”€ā”€ organizer/
ā”‚   ā”ā”€ā”€ installation/
ā”‚   ā””ā”€ā”€ inspection/
ā”ā”€ā”€ shared/             # Jagatud kood
ā”‚   ā”ā”€ā”€ components/
ā”‚   ā”ā”€ā”€ hooks/
ā”‚   ā””ā”€ā”€ utils/
ā””ā”€ā”€ i18n/
```

## š”„ Refaktoreerimise Muster

### Samm 1: Loo Hook
```typescript
// src/features/admin/hooks/useUserPermissions.ts
export function useUserPermissions(projectId: string) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Kopeeri funktsioonid siia
  const loadUsers = useCallback(async () => { /* ... */ }, [projectId]);
  const saveUser = async (user: User) => { /* ... */ };
  
  useEffect(() => { loadUsers(); }, [loadUsers]);
  
  return { users, loading, saveUser, loadUsers };
}
```

### Samm 2: Loo Komponent
```typescript
// src/features/admin/components/UserPermissionsPanel.tsx
import { useUserPermissions } from '../hooks/useUserPermissions';

export function UserPermissionsPanel({ projectId }: Props) {
  const { users, loading, saveUser } = useUserPermissions(projectId);
  // Kopeeri JSX siia (MAX 500 rida!)
}
```

### Samm 3: Uuenda Parent
```typescript
// AdminScreen.tsx
import { UserPermissionsPanel } from '../features/admin';

// Asenda vana JSX:
{adminView === 'userPermissions' && (
  <UserPermissionsPanel projectId={projectId} />
)}

// KUSTUTA vanad useState'd ja funktsioonid!
```

## š“‹ Backlog

**Loe BACKLOG.md faili Ć¼lesannete jĆ¤rjekorra jaoks!**

## š¨ i18n Reeglid

```typescript
// ā… Ć•IGE
const { t } = useTranslation('admin');
<span>{t('users.title')}</span>

// ā¯ VALE - Hardcoded tekst!
<span>Users</span>
```

**Namespace'id:** common, admin, delivery, installation, inspection, organizer, errors, tools

## š§Ŗ Testimise NĆµuded

Iga uus hook PEAB omama testi:
```
src/features/admin/hooks/
ā”ā”€ā”€ useUserPermissions.ts
ā””ā”€ā”€ useUserPermissions.test.ts  ā† NĆ•UTUD!
```

---

*Kui see fail on liiga pikk, loe BACKLOG.md konkreetsete Ć¼lesannete jaoks.*# Assembly Inspector - Claude Memory

## Kiire Ülevaade

**Trimble Connect laiendus** kvaliteedikontrolliks, tarnegraafiku ja paigaldusgraafiku halduseks.

| Tehnoloogia | Versioon |
|-------------|----------|
| React + TypeScript | 18.x / 5.x |
| Vite | 5.x |
| Trimble Connect Workspace API | 0.3.33 |
| Supabase | PostgreSQL |

## Dokumentatsioon

| Fail | Sisu |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Süsteemi arhitektuur, andmevoog |
| [docs/DATABASE.md](docs/DATABASE.md) | Andmebaasi skeem, tabelid |
| [docs/API.md](docs/API.md) | Trimble API, Supabase, GUID teisendused |
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | Komponentide hierarhia, state'd |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Koodireeglid, patterns |

## Versioonihaldus

**ALATI** uuenda versiooni kahes kohas:
1. `src/App.tsx` → `APP_VERSION`
2. `package.json` → `version`

```bash
# Commit formaat
v3.0.XXX: Lühike kirjeldus
```

## Peamised Komponendid

| Komponent | Funktsioon |
|-----------|------------|
| `App.tsx` | Autentimine, navigatsioon |
| `DeliveryScheduleScreen.tsx` | Tarnegraafik, veokid, eksport |
| `InstallationScheduleScreen.tsx` | Paigaldusgraafik |
| `AdminScreen.tsx` | Seaded, "Saada andmebaasi" |
| `PropertyMappingsContext.tsx` | Tekla property seaded |

## Olulised Mehhanismid

### Property Mappings (KRIITILINE!)
**REEGL:** KÕIK komponendid mis loevad mudeli properteid PEAVAD kasutama `useProjectPropertyMappings` hook'i!

```typescript
import { useProjectPropertyMappings } from '../contexts/PropertyMappingsContext';

const { mappings: propertyMappings } = useProjectPropertyMappings(projectId);
```

- Projekti-põhised Tekla property seaded (Admin → Tekla property seaded)
- Tabel: `project_property_mappings`
- Cache + invalidation listeners
- Ilma selleta näidatakse `Object_xxx` õige assembly marki asemel
- Vt `docs/CONVENTIONS.md` detailsema juhendi jaoks

### GUID Unikaalsus
- Unikaalsus: `(trimble_project_id, guid_ifc)`
- Sama GUID erinevates mudeliversioonides → uuendatakse
- Delete + Insert pattern (mitte upsert ignoreDuplicates)

### Checkbox Multi-Select (Tarnegraafik)
- `syncingToModelRef` lipp hoiab ära valiku tühistamise
- Timeout 2000ms (katab 1.5s polling)
- `e.stopPropagation()` checkbox onClick'is

### Excel Eksport
- Kaalud ümardatud 1 komakohani
- `xlsx-js-style` teek

## Andmebaasi Tabelid

| Tabel | Kirjeldus |
|-------|-----------|
| `trimble_model_objects` | Mudeli objektide cache |
| `project_property_mappings` | Property seaded |
| `trimble_delivery_vehicles` | Veokid |
| `trimble_delivery_items` | Tarnedetailid |
| `trimble_delivery_factories` | Tehased |
| `installation_schedule_items` | Paigaldusgraafik |
| `inspections` | Kvaliteedikontroll |
| `trimble_ex_users` | Kasutajad |

## Development Workflow

```bash
# 1. Tee muudatused
# 2. Uuenda versioon (App.tsx + package.json)
# 3. Build
npm run build

# 4. Commit
git add -A && git commit -m "v3.0.XXX: Kirjeldus"

# 5. Push
git push -u origin branch-name

# 6. Deploy (PR + merge)
gh pr create --title "v3.0.XXX: Title" --body "Description"
gh pr merge --squash
```

## Sagedased Probleemid

### "Object_xxx" assembly mark asemel
- Property mappings pole õigesti seadistatud
- Kontrolli Admin → Tekla property seaded
- Kontrolli, et mappings laaditakse enne operatsiooni

### Checkbox valik tühistub
- `syncingToModelRef` timeout liiga lühike
- Peaks olema 2000ms (katab polling 1.5s)

### Duplikaadid andmebaasis
- Kasuta delete + insert, mitte upsert ignoreDuplicates
- Unikaalsus peab olema `(project_id, guid_ifc)`

### Property'd ei leia
- Toeta mõlemat formaati: `propertySets` ja `properties` array
- Normaliseeri nimesid: `s.replace(/\s+/g, '').toLowerCase()`

### Värvimine graafikutes (LAHENDATUD)
Mõlemad graafikud (tarne- ja paigaldusgraafik) kasutavad nüüd andmebaasi-põhist värvimise loogikat:
- Loetakse kõik objektid `trimble_model_objects` tabelist
- Värvimine toimub ainult nende objektide põhjal mis on andmebaasis
- Graafiku-välised objektid värvitakse valgeks, graafikus olevad oma kuupäeva järgi

### Organiseeri lehe grupi värvimine (KRIITILINE!)
**REEGL:** "Värvi see grupp" ja "Värvi gruppide kaupa" kasutavad SAMA loogikat!

Funktsioon `colorModelByGroups(targetGroupId?: string)` töötab nii:
1. **Loe andmebaasist** - kõik GUID-id `trimble_model_objects` tabelist
2. **Otsi mudelist** - `findObjectsInLoadedModels()` leiab runtime ID-d
3. **Määra grupid** - `groupsToProcess` = kas kõik grupid või ainult sihtgrupp
4. **Kogu värvid** - `guidToColor` Map sisaldab ainult `groupsToProcess` gruppide elemente
5. **Värvi valgeks** - KÕIK objektid mis EI OLE `guidToColor`-is värvitakse valgeks
6. **Värvi grupid** - `guidToColor` elemendid saavad grupi värvi

```typescript
// Valge värvimise loogika - SAMA mõlemal juhul:
const whiteByModel: Record<string, number[]> = {};
for (const [guidLower, found] of foundByLowercase) {
  if (!guidToColor.has(guidLower)) {  // Kui pole grupeeritud
    whiteByModel[found.modelId].push(found.runtimeId);
  }
}
// Värvi valgeks batchides
await api.viewer.setObjectState({ modelObjectIds: [...] }, { color: white });
```

**Erinevus:**
- `colorModelByGroups()` - kõik grupid → `guidToColor` sisaldab KÕIKI grupeeritud elemente → ainult mitte-grupeeritud valgeks
- `colorModelByGroups(groupId)` - üks grupp → `guidToColor` sisaldab AINULT selle grupi elemente → KÕIK TEISED (sh teised grupid) valgeks

**Elementide lisamisel gruppi:**
- Kasuta `colorItemsDirectly()` funktsiooni AINULT lisatud elementide värvimiseks
- Kasuta `refreshData()` (mitte `loadData()`) et vältida UI vilkumist
