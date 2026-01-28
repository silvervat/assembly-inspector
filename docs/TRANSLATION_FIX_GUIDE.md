# Assembly Inspector - Tõlgete Parandamise Juhend Claude Code'ile

## 🎯 ÜLESANNE

Paranda Assembly Inspector projekti tõlked nii, et **100% kasutajale nähtavast tekstist** tuleks tõlkefailidest ja töötaks mõlemas keeles (ET ja EN).

---

## 📋 SAMM-SAMMULINE TEGEVUSKAVA

### SAMM 1: Registreeri puuduv `tools` namespace

**Probleem:** `src/i18n/locales/et/tools.json` ja `en/tools.json` failid eksisteerivad, AGA pole registreeritud `src/i18n/index.ts` failis. Seetõttu kuvatakse lehel võtme teed (`sections.cranePlanning`) mitte tõlkeid.

**Tegevus:** Muuda `src/i18n/index.ts`:

```typescript
// Lisa importide juurde (ridade 5-12 ja 14-21 juurde):
import etTools from './locales/et/tools.json';
import enTools from './locales/en/tools.json';

// Lisa resources objekti (rida 28-49):
export const resources = {
  et: {
    common: etCommon,
    delivery: etDelivery,
    installation: etInstallation,
    inspection: etInspection,
    organizer: etOrganizer,
    admin: etAdmin,
    errors: etErrors,
    tools: etTools,  // ← LISA SEE RIDA
  },
  en: {
    common: enCommon,
    delivery: enDelivery,
    installation: enInstallation,
    inspection: enInspection,
    organizer: enOrganizer,
    admin: enAdmin,
    errors: enErrors,
    tools: enTools,  // ← LISA SEE RIDA
  },
} as const;
```

**Kontrolli:** `npm run build` peab õnnestuma.

---

### SAMM 2: Sünkroniseeri ET ja EN tõlkefailide võtmed

**Probleem:** ET ja EN failides on erinevad võtmed.

**Tegevus:** Käivita iga namespace'i jaoks võrdlus ja lisa puuduvad võtmed:

```bash
cd src/i18n/locales

# Iga faili jaoks:
for ns in common admin delivery installation inspection organizer tools errors; do
  echo "=== $ns.json ==="
  
  # Puudub EN-s (olemas ET-s):
  echo "Missing in EN:"
  diff <(cat et/$ns.json | jq -r 'paths | join(".")' | sort) \
       <(cat en/$ns.json | jq -r 'paths | join(".")' | sort) | grep "^<" | sed 's/^< //'
  
  # Puudub ET-s (olemas EN-s):
  echo "Missing in ET:"
  diff <(cat et/$ns.json | jq -r 'paths | join(".")' | sort) \
       <(cat en/$ns.json | jq -r 'paths | join(".")' | sort) | grep "^>" | sed 's/^> //'
  
  echo ""
done
```

**Peamised puuduvad võtmed:**

1. **common.json** - Lisa EN faili:
   - `bulkAction.*` (kõik ~15 võtit)
   - `buttons.createVersion`, `buttons.loading`, `buttons.loadingData`, `buttons.saveAndContinue`, `buttons.saveView`, `buttons.savingDots`, `buttons.updateName`
   - `crane.*` (kõik ~60 võtit)
   - `gallery.image`
   - `inspectionList.*` (kõik ~30 võtit)
   - `positionerPopup.*` (kõik ~15 võtit)
   - `status.changesSaved`, `status.loadError`, `status.saveError`

2. **common.json** - Lisa ET faili:
   - `arrivals.*` (kõik ~100 võtit)

---

### SAMM 3: Leia ja paranda hardcoded tekstid komponentides

**Tegevus:** Otsi ja paranda kõik hardcoded tekstid:

```bash
# 1. Leia eestikeelsed tekstid (täpitähed)
grep -rn "[ÕÄÖÜõäöü]" src/components/*.tsx | grep -v "// " | grep -v ".json" | grep -v "className"

# 2. Leia setMessage/alert/throw ilma t() funktsioonita
grep -rn "setMessage\|setError\|alert\|throw new Error" src/components/*.tsx | grep -v "t(" | grep "'" 

# 3. Leia hardcoded tabeli päised
grep -rn "<th>" src/components/*.tsx | grep -v "t("
```

**Peamised parandamist vajavad kohad `AdminScreen.tsx`:**

| Rida | Praegune | Peaks olema |
|------|----------|-------------|
| 984 | `'Sisesta vähemalt üks GUID!'` | `t('admin:guid.enterAtLeastOne')` |
| 1034 | `'Popup blocker võib...'` | `t('admin:popupBlocked')` |
| 1061 | `'Viga toimingu tegemisel'` | `t('admin:operationError')` |
| 1296 | `'Otsin objekte...'` | `t('admin:searchingObjects')` |
| 1319 | `'Ühtegi kehtivat GUID...'` | `t('admin:guid.noValidMsFound')` |
| 1337 | `'Mudeleid ei leitud'` | `t('admin:guid.modelsNotFound')` |
| 1411 | `'Ühtegi objekti ei leitud'` | `t('admin:viewer.noObjectsFound')` |
| 5451-5453 | `<th>Märk</th>` jne | `<th>{t('admin:tables.mark')}</th>` |
| 13141-13146 | Kasutajate tabeli päised | Tõlgitud päised |
| 15441-15443 | Detailide tabeli päised | Tõlgitud päised |

---

### SAMM 4: Lisa puuduvad tõlkevõtmed admin.json failidesse

**Lisa `src/i18n/locales/et/admin.json`:**

```json
{
  "tables": {
    "mark": "Märk",
    "date": "Kuupäev",
    "added": "Lisatud",
    "match": "Vaste",
    "action": "Tegevus",
    "name": "Nimi",
    "email": "Email",
    "role": "Roll",
    "status": "Staatus",
    "joined": "Liitunud",
    "lastModified": "Viimati muudetud",
    "castUnitMark": "Cast Unit Mark",
    "productName": "Toode",
    "weight": "Kaal",
    "boltName": "Poldi nimi",
    "standard": "Standard",
    "count": "Arv",
    "found": "Leitud",
    "notFound": "Ei leitud",
    "total": "Kokku"
  },
  "popupHtml": {
    "nothingSelected": "Midagi pole valitud",
    "connected": "Ühendatud"
  },
  "export": {
    "plannedDelivery": "Planeeritud tarne",
    "actualArrival": "Tegelik saabumine",
    "deliveryStatus": "Tarne staatus"
  }
}
```

**Lisa `src/i18n/locales/en/admin.json`:**

```json
{
  "tables": {
    "mark": "Mark",
    "date": "Date",
    "added": "Added",
    "match": "Match",
    "action": "Action",
    "name": "Name",
    "email": "Email",
    "role": "Role",
    "status": "Status",
    "joined": "Joined",
    "lastModified": "Last modified",
    "castUnitMark": "Cast Unit Mark",
    "productName": "Product",
    "weight": "Weight",
    "boltName": "Bolt Name",
    "standard": "Standard",
    "count": "Count",
    "found": "Found",
    "notFound": "Not found",
    "total": "Total"
  },
  "popupHtml": {
    "nothingSelected": "Nothing selected",
    "connected": "Connected"
  },
  "export": {
    "plannedDelivery": "Planned delivery",
    "actualArrival": "Actual arrival",
    "deliveryStatus": "Delivery status"
  }
}
```

---

### SAMM 5: Paranda popup akende hardcoded tekstid

**Probleem:** Popup aknad (window.open) kasutavad hardcoded HTML tekste.

**Tegevus `AdminScreen.tsx`:**

1. Leia popup HTML (nt rida 1078-1126 Selection Monitor)
2. Asenda hardcoded tekstid dünaamiliste väärtustega:

```typescript
// Enne popup avamist, kogu tõlked:
const popupTranslations = {
  nothingSelected: t('admin:popupHtml.nothingSelected'),
  connected: t('admin:popupHtml.connected'),
  // ... jne
};

// Popup HTML-is kasuta template literal:
const popupHtml = `
  <div class="empty">${popupTranslations.nothingSelected}</div>
`;
```

---

### SAMM 6: Kontrolli tulemust

```bash
# 1. Build peab õnnestuma
npm run build

# 2. Kontrolli, et pole enam hardcoded eesti tekste
grep -rn "[ÕÄÖÜõäöü]" src/components/*.tsx | grep -v "// " | grep -v ".json" | wc -l
# Peaks olema 0 või minimaalne (ainult kommentaarid)

# 3. Kontrolli võtmete sünkrooni
cd src/i18n/locales
for ns in common admin delivery installation inspection organizer tools errors; do
  diff <(cat et/$ns.json | jq -r 'paths | join(".")' | sort) \
       <(cat en/$ns.json | jq -r 'paths | join(".")' | sort) | wc -l
done
# Iga faili jaoks peaks olema 0
```

---

## ⚠️ REEGLID

1. **KUNAGI ära lisa hardcoded tekste** - alati `t('namespace:key')`
2. **Iga uus võti peab olema mõlemas keeles** (ET ja EN)
3. **Uue namespace'i puhul registreeri see `i18n/index.ts` failis**
4. **Kasuta interpolatsiooni:** `t('key', { count: 5 })` mitte string concatenation
5. **Tabeli päised, nupud, veateated, kinnitused** - KÕIK peavad tulema tõlkefailidest

---

## 📁 FAILIDE ASUKOHT

| Fail | Otstarve |
|------|----------|
| `src/i18n/index.ts` | Namespace'ide registreerimine |
| `src/i18n/locales/et/*.json` | Eesti tõlked |
| `src/i18n/locales/en/*.json` | Inglise tõlked |
| `src/components/*.tsx` | Komponendid kus kasutada `t()` |

---

## 🔧 KASULIKUD KÄSUD

```bash
# Leia kõik t() kutsed failis
grep -on "t('[^']*')" src/components/AdminScreen.tsx | head -50

# Leia kõik unikaalsed namespace:key kombinatsioonid
grep -roh "t('[^']*')" src/components/*.tsx | sort -u

# Kontrolli kas võti eksisteerib
grep "searchingObjects" src/i18n/locales/et/admin.json

# Leia puuduvad tõlked (debug mode)
# Lisa src/i18n/index.ts faili: debug: true
```

---

## ✅ LÕPLIK CHECKLIST

- [ ] `tools` namespace registreeritud `i18n/index.ts` failis
- [ ] Kõik namespace'id sünkroonis (ET = EN võtmed)
- [ ] Kõik hardcoded eesti tekstid asendatud `t()` kutsetega
- [ ] Kõik tabeli päised tõlgitud
- [ ] Kõik veateated tõlgitud
- [ ] Kõik nupud tõlgitud
- [ ] Popup aknad kasutavad tõlkeid
- [ ] `npm run build` õnnestub
- [ ] Versioon uuendatud (App.tsx + package.json)
