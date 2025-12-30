# Assembly Inspector - Süsteemi Arhitektuur

## Ülevaade

Assembly Inspector on Trimble Connect laiendus (extension), mis töötab Trimble Connect Workspace API kaudu. Rakendus võimaldab kvaliteedikontrolli, tarnegraafiku haldust ja paigaldusgraafiku planeerimist.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Trimble Connect                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   3D Viewer (IFC mudelid)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                    Workspace API v0.3.33                         │
│                              │                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Assembly Inspector (React App)               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │   │
│  │  │MainMenu │ │Inspector│ │Delivery │ │Installation     │ │   │
│  │  │         │ │Screen   │ │Schedule │ │Schedule         │ │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘ │   │
│  │                          │                                │   │
│  │              PropertyMappingsContext                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase                                 │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐   │
│  │ inspections    │ │ delivery_      │ │ trimble_model_     │   │
│  │                │ │ schedule       │ │ objects            │   │
│  └────────────────┘ └────────────────┘ └────────────────────┘   │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐   │
│  │ trimble_ex_    │ │ installation_  │ │ project_property_  │   │
│  │ users          │ │ schedule       │ │ mappings           │   │
│  └────────────────┘ └────────────────┘ └────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Tehnoloogiad

| Tehnoloogia | Versioon | Kasutus |
|-------------|----------|---------|
| React | 18.x | UI framework |
| TypeScript | 5.x | Tüübitud JavaScript |
| Vite | 5.x | Build tool |
| Trimble Connect Workspace API | 0.3.33 | 3D viewer, mudeli andmed |
| Supabase | - | PostgreSQL andmebaas |
| xlsx-js-style | - | Excel eksport |

## Peamised Moodulid

### 1. App.tsx
- Autentimine Trimble kasutaja emaili järgi
- Navigatsioon ekraanide vahel
- Versiooni haldus (`APP_VERSION`)

### 2. PropertyMappingsContext
- **Eesmärk**: Tekla property nimede seadistamine projekti põhiselt
- **Cache süsteem**: Hoiab mappings mälus, teavitab muudatustest
- **Konfigureeritavad väljad**:
  - `assembly_mark_set` / `assembly_mark_prop`
  - `weight_set` / `weight_prop`
  - `position_code_set` / `position_code_prop`
  - `top_elevation_set` / `top_elevation_prop`
  - `bottom_elevation_set` / `bottom_elevation_prop`
  - `guid_set` / `guid_prop`

### 3. Ekraanid

| Ekraan | Fail | Funktsioon |
|--------|------|------------|
| MainMenu | `MainMenu.tsx` | Peamenüü, režiimi valik |
| InspectorScreen | `InspectorScreen.tsx` | Kvaliteedikontroll |
| DeliveryScheduleScreen | `DeliveryScheduleScreen.tsx` | Tarnegraafik, veokid |
| InstallationScheduleScreen | `InstallationScheduleScreen.tsx` | Paigaldusgraafik |
| AdminScreen | `AdminScreen.tsx` | Seaded, "Saada andmebaasi" |

## Andmevoog

### Mudelist Andmebaasi
```
1. Kasutaja valib objektid mudelis (või "KÕIK assemblyd")
2. api.viewer.getObjectProperties() → Tekla property'd
3. api.viewer.convertToObjectIds() → IFC GUID'd
4. PropertyMappings → õige property lugemine
5. Supabase insert/upsert → andmebaasi
```

### Tarnegraafik Valik
```
1. Kasutaja klõpsab checkbox'il
2. setSelectedItemIds() → React state
3. useEffect → syncingToModelRef = true
4. selectObjectsByGuid() → mudeli valik
5. 2s pärast → syncingToModelRef = false
6. handleSelectionChange() kontrollib lippu → ei tühjenda valikut
```

## Unikaalsuse Loogika

### trimble_model_objects
- Unikaalsus: `(trimble_project_id, guid_ifc)`
- Sama GUID erinevates mudeliversioonides → uuendatakse
- Sama GUID erinevates projektides → lubatud

### delivery_schedule / installation_schedule
- Unikaalsus: `id` (UUID)
- Objekti tuvastamine: `guid_ifc` või `guid`

## Deployment

```
GitHub repo → GitHub Actions → GitHub Pages
                    │
                    ├── npm install
                    ├── npm run build
                    └── Deploy to gh-pages branch
```

URL: `https://[username].github.io/assembly-inspector/`
