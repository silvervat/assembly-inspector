# LISA BACKLOG - Faaside 9-11 ülesanded

> **JUHIS:** Kopeeri see sisu BACKLOG-FULL.md faili lõppu (enne "LÕPETATUD" sektsiooni)

---

## 🔴 FAAS 9: KOODI KVALITEET (3 päeva)

### [F9-001] Paigalda ESLint + Prettier
**Prioriteet:** P0 | **Aeg:** 1h

**Käsk Claude Code'ile:**
```
Paigalda ESLint ja Prettier:

npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install -D prettier eslint-config-prettier eslint-plugin-react-hooks
npm install -D eslint-plugin-react

Loo .eslintrc.cjs fail:
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'prettier'
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    'no-console': 'warn'
  }
};

Loo .prettierrc fail:
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}

Lisa package.json scripts:
"lint": "eslint src --ext .ts,.tsx",
"lint:fix": "eslint src --ext .ts,.tsx --fix",
"format": "prettier --write src/"

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F9-002] Eemalda TypeScript `any` - Osa 1 (hooks, utils)
**Prioriteet:** P0 | **Aeg:** 3h

**Käsk Claude Code'ile:**
```
Eemalda kõik "any" tüübid src/hooks/ ja src/utils/ kaustadest.

Asenda:
- catch (e: any) → catch (e) { if (e instanceof Error) ... }
- obj: any → obj: unknown või konkreetne tüüp
- data: any → data: ConcreteType

Ära muuda komponente, ainult hooks ja utils.
Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F9-003] Eemalda TypeScript `any` - Osa 2 (features)
**Prioriteet:** P0 | **Aeg:** 4h

**Käsk Claude Code'ile:**
```
Eemalda kõik "any" tüübid src/features/ kaustast.

Loo puuduvad interface'id src/features/*/types/ kaustadesse.
Kasuta unknown kui tüüp pole teada, mitte any.

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F9-004] Eemalda console.log produktsioonist
**Prioriteet:** P1 | **Aeg:** 2h

**Käsk Claude Code'ile:**
```
Loo src/shared/utils/logger.ts:

const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args: unknown[]) => isDev && console.log(...args),
  error: (...args: unknown[]) => console.error(...args), // Alati näita
  warn: (...args: unknown[]) => isDev && console.warn(...args),
  debug: (...args: unknown[]) => isDev && console.debug(...args),
};

Seejärel asenda KÕIK console.log → logger.log
Jäta console.error alles kriitiliste vigade jaoks.

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F9-005] Tükelda App.css - Osa 1 (variables + base)
**Prioriteet:** P1 | **Aeg:** 2h

**Käsk Claude Code'ile:**
```
Loo src/styles/ struktuur:

1. Loo src/styles/variables.css
   - Kopeeri App.css-st :root { ... } sektsioon (~100 rida)

2. Loo src/styles/base.css
   - Kopeeri App.css-st *, html, body, #root stiilid (~50 rida)

3. Loo src/styles/index.css
   @import './variables.css';
   @import './base.css';

4. Uuenda src/main.tsx importima './styles/index.css'

Ära veel kustuta App.css-st midagi, ainult kopeeri.
Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F9-006] Tükelda App.css - Osa 2 (komponendid)
**Prioriteet:** P1 | **Aeg:** 4h

**Käsk Claude Code'ile:**
```
Jätka App.css tükeldamist:

Iga suure komponendi jaoks loo eraldi CSS fail:
- src/features/admin/components/AdminScreen.css
- src/features/organizer/components/OrganizerScreen.css
- src/features/delivery/components/DeliverySchedule.css

Kopeeri App.css-st vastavad stiilid (.admin-*, .organizer-*, .delivery-*).
Lisa import komponendi faili: import './AdminScreen.css';

Pärast kopeerimist kustuta duplikaadid App.css-st.
Eesmärk: App.css < 2000 rida.

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

## 🟡 FAAS 10: ACCESSIBILITY (2 päeva)

### [F10-001] Lisa ARIA atribuudid nuppudele
**Prioriteet:** P1 | **Aeg:** 3h

**Käsk Claude Code'ile:**
```
Lisa ARIA atribuudid kõigile interaktiivsetele elementidele src/features/ kaustas:

Nupud:
<button aria-label="Sulge" title="Sulge">×</button>

Ikoonid:
<FiSearch aria-hidden="true" />
<span className="sr-only">Otsi</span>

Modaalid:
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">

Loo src/styles/accessibility.css:
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F10-002] Lisa keyboard navigation
**Prioriteet:** P1 | **Aeg:** 2h

**Käsk Claude Code'ile:**
```
Lisa keyboard navigation kriitilisettele komponentidele:

1. Modaalid: ESC sulgeb
useEffect(() => {
  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  window.addEventListener('keydown', handleEsc);
  return () => window.removeEventListener('keydown', handleEsc);
}, [onClose]);

2. Dropdown menüüd: Arrow keys navigatsioon

3. Tabelid: Tab navigatsioon ridade vahel

4. Lisa tabIndex={0} interaktiivsetele elementidele mis pole nupud

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F10-003] Lisa focus management
**Prioriteet:** P1 | **Aeg:** 2h

**Käsk Claude Code'ile:**
```
Lisa focus management:

1. Modaali avamisel fookus esimesele elemendile:
const firstFocusable = useRef<HTMLButtonElement>(null);
useEffect(() => {
  if (isOpen) firstFocusable.current?.focus();
}, [isOpen]);

2. Modaali sulgemisel fookus tagasi triggerile

3. Focus trap modaalides (tab ei lahku modaalist)

4. Lisa focus-visible stiilid:
:focus-visible {
  outline: 2px solid var(--modus-primary);
  outline-offset: 2px;
}

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F10-004] Lisa skip link
**Prioriteet:** P2 | **Aeg:** 30min

**Käsk Claude Code'ile:**
```
Lisa skip link App.tsx algusesse:

<a href="#main-content" className="skip-link">
  Liigu põhisisu juurde
</a>

<main id="main-content">
  {/* ... */}
</main>

CSS:
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--modus-primary);
  color: white;
  padding: 8px;
  z-index: 100;
}
.skip-link:focus {
  top: 0;
}

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

## 🟢 FAAS 11: MONITORING & ERROR TRACKING (1 päev)

### [F11-001] Paigalda Sentry
**Prioriteet:** P1 | **Aeg:** 2h

**Käsk Claude Code'ile:**
```
Paigalda Sentry error tracking:

npm install @sentry/react

Loo src/shared/utils/sentry.ts:
import * as Sentry from '@sentry/react';

export function initSentry() {
  if (import.meta.env.PROD) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
  }
}

export { Sentry };

Lisa main.tsx-i:
import { initSentry } from './shared/utils/sentry';
initSentry();

Lisa .env.example:
VITE_SENTRY_DSN=

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F11-002] Integreeri Sentry ErrorBoundary'ga
**Prioriteet:** P1 | **Aeg:** 1h

**Käsk Claude Code'ile:**
```
Uuenda ErrorBoundary kasutama Sentry't:

import { Sentry } from '../utils/sentry';

componentDidCatch(error: Error, info: React.ErrorInfo) {
  console.error('Error caught:', error, info);
  
  if (import.meta.env.PROD) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack }
    });
  }
}

Lisa ka Sentry.ErrorBoundary wrapper App.tsx-i:
import { Sentry } from './shared/utils/sentry';

<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
  <App />
</Sentry.ErrorBoundary>

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F11-003] Lisa performance monitoring
**Prioriteet:** P2 | **Aeg:** 1h

**Käsk Claude Code'ile:**
```
Lisa Web Vitals monitoring:

npm install web-vitals

Loo src/shared/utils/vitals.ts:
import { onCLS, onFID, onLCP, onFCP, onTTFB } from 'web-vitals';
import { Sentry } from './sentry';

export function reportWebVitals() {
  if (import.meta.env.PROD) {
    onCLS((metric) => Sentry.captureMessage(`CLS: ${metric.value}`));
    onFID((metric) => Sentry.captureMessage(`FID: ${metric.value}`));
    onLCP((metric) => Sentry.captureMessage(`LCP: ${metric.value}`));
  }
}

Lisa main.tsx-i:
import { reportWebVitals } from './shared/utils/vitals';
reportWebVitals();

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

### [F11-004] Uuenda CI/CD pipeline
**Prioriteet:** P1 | **Aeg:** 1h

**Käsk Claude Code'ile:**
```
Uuenda .github/workflows/deploy.yml:

Lisa pärast "Install dependencies" sammu:

- name: 🔍 Run linter
  run: npm run lint

- name: 🧪 Run tests
  run: npm test -- --run

- name: 📊 Check test coverage
  run: npm run test:coverage

- name: 📦 Upload coverage to Codecov
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info

Märgi ülesanne lõpetatuks.
```

**Staatus:** ⏳ Ootel

---

## 📊 UUENDATUD PROGRESS TABEL

> **JUHIS:** Asenda BACKLOG-FULL.md alguses olev progress tabel selle uuega:

```markdown
## 📊 PROGRESS

| Faas | Sisu | Staatus | Progress |
|------|------|---------|----------|
| 1 | Infrastruktuur | ⏳ Ootel | 0/6 |
| 2 | AdminScreen tükeldamine | ⏳ Ootel | 0/12 |
| 3 | State Management | ⏳ Ootel | 0/4 |
| 4 | OrganizerScreen tükeldamine | ⏳ Ootel | 0/7 |
| 5 | DeliveryScheduleScreen tükeldamine | ⏳ Ootel | 0/7 |
| 6 | Testimine | ⏳ Ootel | 0/5 |
| 7 | Error Handling & UX | ⏳ Ootel | 0/4 |
| 8 | i18n (FI, RU) | ⏳ Ootel | 0/3 |
| 9 | Koodi kvaliteet | ⏳ Ootel | 0/6 |
| 10 | Accessibility | ⏳ Ootel | 0/4 |
| 11 | Monitoring | ⏳ Ootel | 0/4 |

**Kokku: 0/62 ülesannet lõpetatud**
```

---

## 🎯 AJAKAVA KOKKUVÕTE

| Faas | Päevi | Nädal |
|------|-------|-------|
| 1-2 | 7 | Nädal 1-2 |
| 3-5 | 9 | Nädal 2-3 |
| 6-8 | 8 | Nädal 4 |
| 9-11 | 6 | Nädal 5 |
| Buffer | 5 | Nädal 6 |

**Kokku: ~6 nädalat maailmataseme rakenduse saavutamiseks**

---

*Genereeritud: 28. jaanuar 2026*
