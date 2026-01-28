# Assembly Inspector - Maailmataseme BACKLOG

> **VERSIOON:** 2.0 - Hübriid Roadmap (Tükeldamine + State + Testid + Error Handling)
> **VIIMATI UUENDATUD:** 28. jaanuar 2026

---

## 📊 PROGRESS

| Faas | Sisu | Staatus | Progress |
|------|------|---------|----------|
| 1 | Infrastruktuur | āœ… Lƶpetatud | 6/6 |
| 2 | AdminScreen tükeldamine | šŸ"„ Pooleli | 4/12 |
| 3 | State Management | ⏳ Ootel | 0/4 |
| 4 | OrganizerScreen tükeldamine | ⏳ Ootel | 0/7 |
| 5 | DeliveryScreen tükeldamine | ⏳ Ootel | 0/7 |
| 6 | Testimine | ⏳ Ootel | 0/5 |
| 7 | Error Handling & UX | ⏳ Ootel | 0/4 |
| 8 | i18n (FI, RU) | ⏳ Ootel | 0/3 |

**Kokku: 10/48 ülesannet lõpetatud**

---

## 🚨 KRIITILISED REEGLID

```
⚠️ FAILIDE LIMIIDID:
- Komponent: MAX 500 rida
- Hook: MAX 200 rida
- Store: MAX 150 rida
- Test: MAX 300 rida

⚠️ BLOKEERITUD FAILID (liiga suured):
❌ AdminScreen.tsx (18,657 rida)
❌ OrganizerScreen.tsx (14,365 rida)
❌ DeliveryScheduleScreen.tsx (12,594 rida)
❌ InstallationsScreen.tsx (10,679 rida)
❌ InstallationScheduleScreen.tsx (8,974 rida)
❌ ArrivedDeliveriesScreen.tsx (7,701 rida)
```

---

## 🔵 FAAS 1: INFRASTRUKTUUR (2 päeva)

### [F1-001] Paigalda uued teegid
**Prioriteet:** P0 | **Aeg:** 30min

```bash
npm install zustand @tanstack/react-query
npm install -D vitest @testing-library/react @testing-library/jest-dom
npm install -D @vitest/coverage-v8 happy-dom
npm install react-hot-toast
```

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F1-002] Loo kausta struktuur
**Prioriteet:** P0 | **Aeg:** 15min

```bash
mkdir -p src/features/admin/{components,hooks,stores,types}
mkdir -p src/features/delivery/{components,hooks,stores,types}
mkdir -p src/features/organizer/{components,hooks,stores,types}
mkdir -p src/features/installation/{components,hooks,stores}
mkdir -p src/features/inspection/{components,hooks,stores}
mkdir -p src/shared/{components,hooks,stores,utils,types}
mkdir -p src/shared/components/{ui,feedback,layout}
mkdir -p src/test
```

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F1-003] Loo UI Store (Zustand)
**Prioriteet:** P0 | **Aeg:** 1h

**Fail:** `src/shared/stores/uiStore.ts`

```typescript
import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

interface UIState {
  isLoading: boolean;
  loadingMessage: string | null;
  toasts: Toast[];
  
  setLoading: (loading: boolean, message?: string) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isLoading: false,
  loadingMessage: null,
  toasts: [],
  
  setLoading: (loading, message) => 
    set({ isLoading: loading, loadingMessage: message || null }),
    
  addToast: (toast) => set((state) => ({
    toasts: [...state.toasts, { ...toast, id: crypto.randomUUID() }]
  })),
  
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter(t => t.id !== id)
  })),
}));
```

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F1-004] Loo App Store (Zustand)
**Prioriteet:** P0 | **Aeg:** 1h

**Fail:** `src/shared/stores/appStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  projectId: string | null;
  language: 'et' | 'en' | 'fi' | 'ru';
  
  setProject: (id: string | null) => void;
  setLanguage: (lang: AppState['language']) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      projectId: null,
      language: 'et',
      
      setProject: (id) => set({ projectId: id }),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'assembly-inspector-app' }
  )
);
```

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F1-005] Loo React Query Provider
**Prioriteet:** P0 | **Aeg:** 30min

**Fail:** `src/shared/providers/QueryProvider.tsx`

```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 2,
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

**Lisa App.tsx-i:**
```typescript
import { QueryProvider } from './shared/providers/QueryProvider';

// Wrap app:
<QueryProvider>
  <App />
</QueryProvider>
```

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F1-006] Loo Vitest konfiguratsioon
**Prioriteet:** P0 | **Aeg:** 1h

**Fail:** `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'src/test/'],
    },
  },
});
```

**Fail:** `src/test/setup.ts`

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}));
```

**Uuenda package.json:**
```json
"scripts": {
  "test": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:ui": "vitest --ui"
}
```

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

## 🔴 FAAS 2: ADMINSCREEN TÜKELDAMINE (5 päeva)

### [F2-001] Loo Admin types
**Prioriteet:** P0 | **Aeg:** 1h

**Fail:** `src/features/admin/types/index.ts`

Kopeeri AdminScreen.tsx-st kõik interface'id (read ~60-250):
- TeamMember
- TrimbleExUser  
- ProjectResource
- CameraPosition
- QrCodeItem
- DetailPosition
- jne.

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F2-002] Loo useUserStore
**Prioriteet:** P0 | **Aeg:** 2h

**Fail:** `src/features/admin/stores/useUserStore.ts`

**Kopeeri AdminScreen.tsx-st:**
- useState: teamMembers, projectUsers, editingUser, userSearchQuery (read ~293-299)
- Funktsioonid: loadTeamMembers, loadProjectUsers, saveUser, deleteUser

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F2-003] Loo UserPermissionsPanel
**Prioriteet:** P0 | **Aeg:** 3h

**Fail:** `src/features/admin/components/UserPermissionsPanel.tsx`

**Kopeeri AdminScreen.tsx-st:**
- JSX read ~13000-14500
- MAX 500 rida!

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F2-004] Loo useQrStore + QrActivatorPanel
**Prioriteet:** P0 | **Aeg:** 2.5h

**Failid:**
- `src/features/admin/stores/useQrStore.ts`
- `src/features/admin/components/QrActivatorPanel.tsx`

**Kopeeri AdminScreen.tsx-st:**
- useState: qrCodes, qrLoading, newQrLabel (read ~471-495)
- Funktsioonid: loadQrCodes, generateQrCode, deleteQrCode (read ~3139-3490)
- JSX: read ~16000-17500

**Staatus:** āœ… Lƶpetatud
**Lõpetatud:** 2026-01-28

---

### [F2-005] Loo useResourceStore + ResourcesPanel
**Prioriteet:** P0 | **Aeg:** 2.5h

**Failid:**
- `src/features/admin/stores/useResourceStore.ts`
- `src/features/admin/components/ResourcesPanel.tsx`

**Kopeeri AdminScreen.tsx-st:**
- useState: projectResources, resourcesLoading, editingResource (read ~335-353)
- Funktsioonid: loadProjectResources, saveResource, deleteResource (read ~2722-3100)
- JSX: read ~11000-12500

**Staatus:** ⏳ Ootel

---

### [F2-006] Loo CameraPositionsPanel
**Prioriteet:** P0 | **Aeg:** 2h

**Fail:** `src/features/admin/components/CameraPositionsPanel.tsx`

**Staatus:** ⏳ Ootel

---

### [F2-007] Loo DataExportPanel
**Prioriteet:** P0 | **Aeg:** 2h

**Fail:** `src/features/admin/components/DataExportPanel.tsx`

**Staatus:** ⏳ Ootel

---

### [F2-008] Loo PropertyMappingsPanel
**Prioriteet:** P0 | **Aeg:** 1.5h

**Fail:** `src/features/admin/components/PropertyMappingsPanel.tsx`

**Staatus:** ⏳ Ootel

---

### [F2-009] Loo GuidImportPanel
**Prioriteet:** P0 | **Aeg:** 2h

**Fail:** `src/features/admin/components/GuidImportPanel.tsx`

**Staatus:** ⏳ Ootel

---

### [F2-010] Loo PositionerPanel
**Prioriteet:** P0 | **Aeg:** 2.5h

**Fail:** `src/features/admin/components/PositionerPanel.tsx`

**Staatus:** ⏳ Ootel

---

### [F2-011] Loo ModelObjectsPanel + AssemblyListPanel
**Prioriteet:** P0 | **Aeg:** 3h

**Failid:**
- `src/features/admin/components/ModelObjectsPanel.tsx`
- `src/features/admin/components/AssemblyListPanel.tsx`

**Staatus:** ⏳ Ootel

---

### [F2-012] Refaktoreeri AdminScreen shell
**Prioriteet:** P0 | **Aeg:** 2h

**Fail:** `src/components/AdminScreen.tsx`

Pärast kõigi paneelide ekstraktimist peaks AdminScreen olema ~200 rida:
- Import kõik paneelid
- Tab navigation
- Render õige paneel vastavalt activeView'le

**Staatus:** ⏳ Ootel

---

## 🟡 FAAS 3: STATE MANAGEMENT (3 päeva)

### [F3-001] Migreeri PropertyMappingsContext → Zustand
**Prioriteet:** P0 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F3-002] Migreeri OrganizerCacheContext → React Query
**Prioriteet:** P0 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F3-003] Loo DeliveryStore
**Prioriteet:** P0 | **Aeg:** 4h

**Fail:** `src/features/delivery/stores/useDeliveryStore.ts`

**Staatus:** ⏳ Ootel

---

### [F3-004] Loo OrganizerStore
**Prioriteet:** P0 | **Aeg:** 4h

**Fail:** `src/features/organizer/stores/useOrganizerStore.ts`

**Staatus:** ⏳ Ootel

---

## 🟠 FAAS 4: ORGANIZERSCREEN TÜKELDAMINE (3 päeva)

### [F4-001] Loo OrganizerGroupsPanel
**Prioriteet:** P0 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F4-002] Loo OrganizerItemsPanel
**Prioriteet:** P0 | **Aeg:** 4h

**Staatus:** ⏳ Ootel

---

### [F4-003] Loo OrganizerFiltersPanel
**Prioriteet:** P0 | **Aeg:** 2h

**Staatus:** ⏳ Ootel

---

### [F4-004] Loo OrganizerColoringPanel
**Prioriteet:** P0 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F4-005] Loo OrganizerDragDropPanel
**Prioriteet:** P1 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F4-006] Loo OrganizerBulkActionsPanel
**Prioriteet:** P1 | **Aeg:** 2h

**Staatus:** ⏳ Ootel

---

### [F4-007] Refaktoreeri OrganizerScreen shell
**Prioriteet:** P0 | **Aeg:** 2h

**Staatus:** ⏳ Ootel

---

## 🟣 FAAS 5: DELIVERYSCHEDULESCREEN TÜKELDAMINE (3 päeva)

### [F5-001] Loo DeliveryVehiclesPanel
**Prioriteet:** P1 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F5-002] Loo DeliveryItemsPanel
**Prioriteet:** P1 | **Aeg:** 4h

**Staatus:** ⏳ Ootel

---

### [F5-003] Loo DeliveryCalendarView
**Prioriteet:** P1 | **Aeg:** 4h

**Staatus:** ⏳ Ootel

---

### [F5-004] Loo DeliveryTimelineView
**Prioriteet:** P1 | **Aeg:** 3h

**Staatus:** ⏳ Ootel

---

### [F5-005] Loo DeliveryExportPanel
**Prioriteet:** P1 | **Aeg:** 2.5h

**Staatus:** ⏳ Ootel

---

### [F5-006] Loo DeliveryImportPanel
**Prioriteet:** P1 | **Aeg:** 2h

**Staatus:** ⏳ Ootel

---

### [F5-007] Refaktoreeri DeliveryScheduleScreen shell
**Prioriteet:** P1 | **Aeg:** 2h

**Staatus:** ⏳ Ootel

---

## 🧪 FAAS 6: TESTIMINE (4 päeva)

### [F6-001] Kirjuta Admin hooks testid
**Prioriteet:** P1 | **Aeg:** 4h

**Failid:**
- `useUserStore.test.ts`
- `useQrStore.test.ts`
- `useResourceStore.test.ts`

**Staatus:** ⏳ Ootel

---

### [F6-002] Kirjuta Admin components testid
**Prioriteet:** P1 | **Aeg:** 6h

**Failid:**
- `UserPermissionsPanel.test.tsx`
- `QrActivatorPanel.test.tsx`
- `ResourcesPanel.test.tsx`

**Staatus:** ⏳ Ootel

---

### [F6-003] Kirjuta Organizer testid
**Prioriteet:** P1 | **Aeg:** 4h

**Staatus:** ⏳ Ootel

---

### [F6-004] Kirjuta Delivery testid
**Prioriteet:** P1 | **Aeg:** 4h

**Staatus:** ⏳ Ootel

---

### [F6-005] Seadista CI/CD testimine
**Prioriteet:** P1 | **Aeg:** 2h

Uuenda `.github/workflows/deploy.yml`:
```yaml
- name: Run tests
  run: npm test -- --run

- name: Check coverage
  run: npm run test:coverage
```

**Staatus:** ⏳ Ootel

---

## 🎨 FAAS 7: ERROR HANDLING & UX (2 päeva)

### [F7-001] Loo ToastContainer
**Prioriteet:** P1 | **Aeg:** 2h

**Fail:** `src/shared/components/feedback/ToastContainer.tsx`

**Staatus:** ⏳ Ootel

---

### [F7-002] Loo ErrorBoundary
**Prioriteet:** P1 | **Aeg:** 2h

**Fail:** `src/shared/components/feedback/ErrorBoundary.tsx`

**Staatus:** ⏳ Ootel

---

### [F7-003] Loo LoadingOverlay
**Prioriteet:** P1 | **Aeg:** 1h

**Fail:** `src/shared/components/feedback/LoadingOverlay.tsx`

**Staatus:** ⏳ Ootel

---

### [F7-004] Integreeri feedback süsteem App.tsx-i
**Prioriteet:** P1 | **Aeg:** 2h

```typescript
// App.tsx
<ErrorBoundary>
  <QueryProvider>
    <ToastContainer />
    <LoadingOverlay />
    {/* ... */}
  </QueryProvider>
</ErrorBoundary>
```

**Staatus:** ⏳ Ootel

---

## 🌍 FAAS 8: i18n (FI, RU) (2 päeva)

### [F8-001] Loo soome keele tõlked
**Prioriteet:** P2 | **Aeg:** 4h

Kopeeri `src/i18n/locales/en/` → `src/i18n/locales/fi/`
Tõlgi kõik 8 JSON faili.

**Staatus:** ⏳ Ootel

---

### [F8-002] Loo vene keele tõlked
**Prioriteet:** P2 | **Aeg:** 4h

Kopeeri `src/i18n/locales/en/` → `src/i18n/locales/ru/`
Tõlgi kõik 8 JSON faili.

**Staatus:** ⏳ Ootel

---

### [F8-003] Uuenda i18n konfiguratsioon
**Prioriteet:** P2 | **Aeg:** 1h

Lisa FI ja RU keeled `src/i18n/index.ts` faili.

**Staatus:** ⏳ Ootel

---

## ✅ LÕPETATUD

(Lõpetatud ülesanded liigutatakse siia)

---

## 📝 MÄRKMED

### Kuidas märkida ülesanne lõpetatuks

1. Muuda staatus: `⏳ Ootel` → `✅ Lõpetatud`
2. Lisa kuupäev: `**Lõpetatud:** 2026-01-XX`
3. Liiguta ülesanne "LÕPETATUD" sektsiooni
4. Uuenda progress tabelit

### Kui tekib probleem

1. Lisa ülesande alla `**PROBLEEM:**` sektsioon
2. Kirjelda probleem
3. Märgi staatus: `🚫 Blokeeritud`

---

*Genereeritud: 28. jaanuar 2026*
