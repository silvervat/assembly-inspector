import { useEffect, useState, useCallback, useRef } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import MainMenu, { InspectionMode } from './components/MainMenu';
import InspectorScreen from './components/InspectorScreen';
import AdminScreen from './components/AdminScreen';
import InspectionPlanScreen from './components/InspectionPlanScreen';
import InstallationsScreen from './components/InstallationsScreen';
import InstallationScheduleScreen from './components/InstallationScheduleScreen';
import DeliveryScheduleScreen from './components/DeliveryScheduleScreen';
import { supabase, TrimbleExUser } from './supabase';
import {
  getPendingNavigation,
  fetchInspectionForNavigation,
  navigateToInspection
} from './utils/navigationHelper';
import { initOfflineQueue } from './utils/offlineQueue';
import './App.css';

// Initialize offline queue on app load
initOfflineQueue();

export const APP_VERSION = '3.0.112';

// Super admin - always has full access regardless of database settings
const SUPER_ADMIN_EMAIL = 'silver.vatsel@rivest.ee';

// Trimble Connect kasutaja info
interface TrimbleConnectUser {
  email: string;
  firstName?: string;
  lastName?: string;
}

// Selected inspection type info
interface SelectedInspectionType {
  id: string;
  code: string;
  name: string;
}

export default function App() {
  const [api, setApi] = useState<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [user, setUser] = useState<TrimbleExUser | null>(null);
  const [tcUser, setTcUser] = useState<TrimbleConnectUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [currentMode, setCurrentMode] = useState<InspectionMode | null>(null);
  const [selectedInspectionType, setSelectedInspectionType] = useState<SelectedInspectionType | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [navigationStatus, setNavigationStatus] = useState<string>('');
  const [isNavigating, setIsNavigating] = useState(false);

  // Track matched inspection types for menu highlighting
  const [matchedTypeIds, setMatchedTypeIds] = useState<string[]>([]);
  const [completedTypeIds, setCompletedTypeIds] = useState<string[]>([]); // Types where selected detail is already inspected
  const lastMenuSelectionRef = useRef<string>('');

  // Kasutaja initsiaalid (S.V) - eesnime ja perekonnanime esitähed
  const getUserInitials = (tcUserData: TrimbleConnectUser | null): string => {
    if (!tcUserData) return '?';

    const firstName = tcUserData.firstName || '';
    const lastName = tcUserData.lastName || '';

    if (firstName && lastName) {
      return `${firstName.charAt(0).toUpperCase()}.${lastName.charAt(0).toUpperCase()}`;
    }

    // Fallback - võta email esimene täht
    if (tcUserData.email) {
      return tcUserData.email.charAt(0).toUpperCase();
    }

    return '?';
  };

  // Ühenduse loomine Trimble Connect'iga ja kasutaja kontroll
  useEffect(() => {
    async function init() {
      try {
        const connected = await WorkspaceAPI.connect(
          window.parent,
          (event: string, data: unknown) => {
            console.log('Workspace event:', event, data);
          },
          30000
        );
        setApi(connected);

        // Hangi projekti ID
        const project = await connected.project.getProject();
        setProjectId(project.id);
        console.log('Connected to project:', project.name);

        // Hangi Trimble Connect kasutaja info
        let tcUserData: TrimbleConnectUser | null = null;
        try {
          const userData = await connected.user.getUser();
          if (userData.email) {
            tcUserData = {
              email: userData.email,
              firstName: userData.firstName,
              lastName: userData.lastName
            };
            setTcUser(tcUserData);
            console.log('TC User:', tcUserData);

            // Super admin check - always has full access
            const isSuperAdmin = userData.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

            // Kontrolli kas kasutaja on registreeritud trimble_inspection_users tabelis
            // Email võrdlus on case-insensitive (mõlemad lowercase)
            const { data: dbUser, error: dbError } = await supabase
              .from('trimble_inspection_users')
              .select('*')
              .eq('email', userData.email.toLowerCase())
              .eq('trimble_project_id', project.id)
              .single();

            console.log('Auth check:', { email: userData.email.toLowerCase(), projectId: project.id, dbUser, dbError });

            if (isSuperAdmin) {
              // Super admin - override with full permissions
              const superAdminUser: TrimbleExUser = dbUser ? {
                ...dbUser,
                role: 'admin',
                can_assembly_inspection: true,
                can_bolt_inspection: true,
                is_active: true
              } : {
                id: 'super-admin',
                project_id: '',
                trimble_project_id: project.id,
                email: userData.email,
                name: 'Super Admin',
                role: 'admin',
                can_assembly_inspection: true,
                can_bolt_inspection: true,
                is_active: true,
                created_at: new Date().toISOString()
              };
              console.log('Super admin authenticated:', superAdminUser);
              setUser(superAdminUser);

              // Kontrolli kas on EOS2-st navigeerimise päring
              await checkPendingNavigation(connected);
            } else if (dbError || !dbUser) {
              console.warn('User not found in trimble_ex_users:', userData.email);
              setAuthError(`Kasutaja "${userData.email}" ei ole registreeritud. Võta ühendust administraatoriga.`);
            } else if (dbUser.is_active === false) {
              console.warn('User account is inactive:', userData.email);
              setAuthError(`Kasutaja "${userData.email}" konto on deaktiveeritud. Võta ühendust administraatoriga.`);
            } else {
              console.log('User authenticated:', dbUser);
              setUser(dbUser);

              // Kontrolli kas on EOS2-st navigeerimise päring
              await checkPendingNavigation(connected);
            }
          } else {
            setAuthError('Trimble Connect kasutaja email ei ole saadaval.');
          }
        } catch (e) {
          console.error('Could not get TC user:', e);
          setAuthError('Trimble Connect kasutaja info laadimine ebaõnnestus.');
        }

        setLoading(false);
      } catch (err: any) {
        setError(err?.message || 'Ühenduse viga Trimble Connect\'iga');
        console.error('Connection error:', err);
        setLoading(false);
      }
    }
    init();
  }, []);

  // Kontrolli kas on ootel navigeerimise päring EOS2-st
  // NB: getPendingNavigation() tühistab päringu kohe lugemisel
  const checkPendingNavigation = async (apiInstance: WorkspaceAPI.WorkspaceAPI) => {
    const pendingNav = getPendingNavigation(); // See juba tühistab päringu
    if (!pendingNav) return;

    console.log('Processing navigation request:', pendingNav);
    setIsNavigating(true);
    setNavigationStatus('Laadin inspektsiooni andmeid...');

    try {
      const inspection = await fetchInspectionForNavigation(pendingNav.inspectionId);
      if (!inspection) {
        setNavigationStatus('Inspektsiooni ei leitud');
        setTimeout(() => {
          setNavigationStatus('');
          setIsNavigating(false);
        }, 3000);
        return;
      }

      const success = await navigateToInspection(
        apiInstance,
        inspection,
        setNavigationStatus
      );

      setTimeout(() => {
        setNavigationStatus('');
        setIsNavigating(false);
      }, success ? 2000 : 3000);

    } catch (e) {
      console.error('Navigation error:', e);
      setNavigationStatus('Navigeerimine ebaõnnestus');
      setTimeout(() => {
        setNavigationStatus('');
        setIsNavigating(false);
      }, 3000);
    }
  };

  // Mine tagasi menüüsse
  const handleBackToMenu = () => {
    setCurrentMode(null);
    setSelectedInspectionType(null);
  };

  // Helper: normalize GUID
  const normalizeGuid = (s: string): string => {
    return s.replace(/^urn:(uuid:)?/i, "").trim();
  };

  // Check which inspection types have the selected detail in their plan
  const checkMatchingInspectionTypes = useCallback(async (guids: string[]) => {
    if (guids.length === 0 || !projectId) {
      setMatchedTypeIds([]);
      setCompletedTypeIds([]);
      return;
    }

    try {
      // Build OR condition for all GUIDs
      const guidConditions = guids.map(g => `guid.eq.${g},guid_ifc.eq.${g}`).join(',');

      // Get plan items that match these GUIDs
      const { data, error } = await supabase
        .from('inspection_plan_items')
        .select('inspection_type_id')
        .eq('project_id', projectId)
        .or(guidConditions);

      if (error) {
        console.error('Error checking matching types:', error);
        setMatchedTypeIds([]);
        setCompletedTypeIds([]);
        return;
      }

      if (data && data.length > 0) {
        const uniqueTypeIds = [...new Set(data.map(item => item.inspection_type_id))];
        console.log('🎯 Matched inspection types:', uniqueTypeIds);
        setMatchedTypeIds(uniqueTypeIds);

        // Now check which of these have completed inspection results
        const guidOrCondition = guids.map(g => `assembly_guid.eq.${g}`).join(',');
        const { data: resultsData, error: resultsError } = await supabase
          .from('inspection_results')
          .select('assembly_guid, plan_item_id, inspection_plan_items!inner(inspection_type_id)')
          .eq('project_id', projectId)
          .or(guidOrCondition);

        if (!resultsError && resultsData && resultsData.length > 0) {
          // Extract unique inspection_type_ids that have results
          const completedIds = [...new Set(
            resultsData
              .map(r => (r.inspection_plan_items as any)?.inspection_type_id)
              .filter(Boolean)
          )];
          console.log('✅ Completed inspection types:', completedIds);
          setCompletedTypeIds(completedIds);
        } else {
          setCompletedTypeIds([]);
        }
      } else {
        setMatchedTypeIds([]);
        setCompletedTypeIds([]);
      }
    } catch (e) {
      console.error('Error in checkMatchingInspectionTypes:', e);
      setMatchedTypeIds([]);
      setCompletedTypeIds([]);
    }
  }, [projectId]);

  // Track selection when on main menu to highlight matching inspection types
  useEffect(() => {
    if (!api || currentMode !== null) {
      // Clear matches when not on main menu
      setMatchedTypeIds([]);
      setCompletedTypeIds([]);
      lastMenuSelectionRef.current = '';
      return;
    }

    const checkMenuSelection = async () => {
      try {
        const selection = await api.viewer.getSelection();

        if (!selection || selection.length === 0) {
          if (lastMenuSelectionRef.current !== '') {
            lastMenuSelectionRef.current = '';
            setMatchedTypeIds([]);
            setCompletedTypeIds([]);
          }
          return;
        }

        // Get selection key for change detection
        const selKey = selection.map(s => `${s.modelId}:${(s.objectRuntimeIds || []).join(',')}`).join('|');
        if (selKey === lastMenuSelectionRef.current) return;
        lastMenuSelectionRef.current = selKey;

        // Only check first selected object (single selection)
        const firstModel = selection[0];
        if (!firstModel.objectRuntimeIds || firstModel.objectRuntimeIds.length === 0) {
          setMatchedTypeIds([]);
          setCompletedTypeIds([]);
          return;
        }

        const modelId = firstModel.modelId;
        const runtimeId = firstModel.objectRuntimeIds[0];

        // Get object properties to find GUIDs
        const props = await (api.viewer as any).getObjectProperties(modelId, [runtimeId], { includeHidden: true });

        if (!props || props.length === 0) {
          setMatchedTypeIds([]);
          setCompletedTypeIds([]);
          return;
        }

        const objProps = props[0];
        const guidsFound: string[] = [];

        // Search for GUIDs in properties
        for (const pset of objProps.properties || []) {
          const propArray = pset.properties || [];
          for (const prop of propArray) {
            const propName = ((prop as any).name || '').toLowerCase().replace(/[\s_()]/g, '');
            const propValue = (prop as any).displayValue ?? (prop as any).value;

            if (!propValue) continue;

            if (propName.includes('guid') || propName === 'globalid') {
              const guidValue = normalizeGuid(String(propValue));
              if (guidValue && !guidsFound.includes(guidValue)) {
                guidsFound.push(guidValue);
              }
            }
          }
        }

        // Also try convertToObjectIds for IFC GUID
        try {
          const externalIds = await api.viewer.convertToObjectIds(modelId, [runtimeId]);
          if (externalIds && externalIds.length > 0 && externalIds[0]) {
            const ifcGuid = normalizeGuid(String(externalIds[0]));
            if (ifcGuid && !guidsFound.includes(ifcGuid)) {
              guidsFound.push(ifcGuid);
            }
          }
        } catch (e) {
          // Ignore
        }

        // Also try getObjectMetadata for MS GUID
        try {
          const metaArr = await (api.viewer as any)?.getObjectMetadata?.(modelId, [runtimeId]);
          const metaOne = Array.isArray(metaArr) ? metaArr[0] : metaArr;
          if (metaOne?.globalId) {
            const msGuid = normalizeGuid(String(metaOne.globalId));
            if (msGuid && !guidsFound.includes(msGuid)) {
              guidsFound.push(msGuid);
            }
          }
        } catch (e) {
          // Ignore
        }

        console.log('📋 Menu selection GUIDs found:', guidsFound);
        await checkMatchingInspectionTypes(guidsFound);

      } catch (e) {
        console.error('Error checking menu selection:', e);
      }
    };

    // Initial check
    checkMenuSelection();

    // Set up selection listener
    const handleSelectionChanged = () => {
      checkMenuSelection();
    };

    try {
      (api.viewer as any).addOnSelectionChanged?.(handleSelectionChanged);
    } catch (e) {
      console.warn('Could not add selection listener:', e);
    }

    // Polling as backup (every 2 seconds)
    const interval = setInterval(checkMenuSelection, 2000);

    return () => {
      clearInterval(interval);
      try {
        (api.viewer as any).removeOnSelectionChanged?.(handleSelectionChanged);
      } catch (e) {
        // Silent
      }
    };
  }, [api, currentMode, checkMatchingInspectionTypes]);

  // Handle inspection type selection from menu
  const handleSelectInspectionType = (typeId: string, typeCode: string, typeName: string) => {
    setSelectedInspectionType({ id: typeId, code: typeCode, name: typeName });
    setCurrentMode('inspection_type');
  };

  const VersionFooter = () => (
    <div style={{
      position: 'fixed',
      bottom: 4,
      right: 8,
      fontSize: 10,
      color: '#999',
      pointerEvents: 'none'
    }}>
      v{APP_VERSION}
    </div>
  );

  // Navigation overlay - shown when navigating from EOS2
  const NavigationOverlay = () => {
    if (!isNavigating && !navigationStatus) return null;

    return (
      <div className="navigation-overlay">
        <div className="navigation-card">
          <div className="navigation-spinner"></div>
          <div className="navigation-status">{navigationStatus}</div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Ühendatakse Trimble Connect'iga...</div>
        <VersionFooter />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h3>Viga</h3>
          <p>{error}</p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Veendu, et laiendus on avatud Trimble Connect keskkonnas.
          </p>
        </div>
        <VersionFooter />
      </div>
    );
  }

  if (!api) {
    return (
      <div className="container">
        API pole saadaval
        <VersionFooter />
      </div>
    );
  }

  // Kasutaja pole autentitud (email puudub tabelis)
  if (authError) {
    return (
      <div className="container">
        <div className="auth-error-card">
          <div className="auth-error-icon">🔒</div>
          <h3>Ligipääs keelatud</h3>
          <p>{authError}</p>
          {tcUser && (
            <div className="auth-error-email">
              Sinu email: <strong>{tcUser.email}</strong>
            </div>
          )}
        </div>
        <VersionFooter />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container">
        <div className="loading">Autentimine...</div>
        <VersionFooter />
      </div>
    );
  }

  // Kui pole veel režiimi valitud, näita menüüd
  if (!currentMode) {
    return (
      <>
        <NavigationOverlay />
        <MainMenu
          user={user}
          userInitials={getUserInitials(tcUser)}
          projectId={projectId}
          onSelectMode={setCurrentMode}
          onSelectInspectionType={handleSelectInspectionType}
          matchedTypeIds={matchedTypeIds}
          completedTypeIds={completedTypeIds}
        />
        <VersionFooter />
      </>
    );
  }

  // Admin ekraan
  if (currentMode === 'admin') {
    return (
      <>
        <NavigationOverlay />
        <AdminScreen
          api={api}
          onBackToMenu={handleBackToMenu}
          projectId={projectId}
        />
        <VersionFooter />
      </>
    );
  }

  // Inspektsiooni kava ekraan
  if (currentMode === 'inspection_plan') {
    return (
      <>
        <NavigationOverlay />
        <InspectionPlanScreen
          api={api}
          projectId={projectId}
          userEmail={tcUser?.email || ''}
          userName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
        />
        <VersionFooter />
      </>
    );
  }

  // Paigaldamiste ekraan
  if (currentMode === 'installations') {
    return (
      <>
        <NavigationOverlay />
        <InstallationsScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
        />
        <VersionFooter />
      </>
    );
  }

  // Paigaldusgraafiku ekraan
  if (currentMode === 'schedule') {
    return (
      <>
        <NavigationOverlay />
        <InstallationScheduleScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
        />
        <VersionFooter />
      </>
    );
  }

  // Tarnegraafiku ekraan
  if (currentMode === 'delivery_schedule') {
    return (
      <>
        <NavigationOverlay />
        <DeliveryScheduleScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          tcUserName={tcUser ? `${tcUser.firstName || ''} ${tcUser.lastName || ''}`.trim() : ''}
          onBackToMenu={handleBackToMenu}
        />
        <VersionFooter />
      </>
    );
  }

  // Inspection type mode - show inspector with selected type
  if (currentMode === 'inspection_type' && selectedInspectionType) {
    return (
      <>
        <NavigationOverlay />
        <InspectorScreen
          api={api}
          user={user}
          projectId={projectId}
          tcUserEmail={tcUser?.email || ''}
          inspectionMode={currentMode}
          inspectionTypeId={selectedInspectionType.id}
          inspectionTypeCode={selectedInspectionType.code}
          inspectionTypeName={selectedInspectionType.name}
          onBackToMenu={handleBackToMenu}
        />
        <VersionFooter />
      </>
    );
  }

  // Näita valitud inspektsiooni ekraani (legacy modes)
  return (
    <>
      <NavigationOverlay />
      <InspectorScreen
        api={api}
        user={user}
        projectId={projectId}
        tcUserEmail={tcUser?.email || ''}
        inspectionMode={currentMode}
        onBackToMenu={handleBackToMenu}
      />
      <VersionFooter />
    </>
  );
}
