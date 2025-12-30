# Assembly Inspector - Claude Memory

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

### Property Mappings
- Projekti-põhised Tekla property seaded
- Tabel: `project_property_mappings`
- Cache + invalidation listeners
- Admin lehel konfigureeritav

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
