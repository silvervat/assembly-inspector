import { useEffect, useState } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import MainMenu, { InspectionMode } from './components/MainMenu';
import InspectorScreen from './components/InspectorScreen';
import AdminScreen from './components/AdminScreen';
import { supabase, TrimbleExUser } from './supabase';
import {
  getPendingNavigation,
  fetchInspectionForNavigation,
  navigateToInspection
} from './utils/navigationHelper';
import './App.css';

export const APP_VERSION = '2.5.26';

// Trimble Connect kasutaja info
interface TrimbleConnectUser {
  email: string;
  firstName?: string;
  lastName?: string;
}

export default function App() {
  const [api, setApi] = useState<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [user, setUser] = useState<TrimbleExUser | null>(null);
  const [tcUser, setTcUser] = useState<TrimbleConnectUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [currentMode, setCurrentMode] = useState<InspectionMode | null>(null);
  const [authError, setAuthError] = useState<string>('');
  const [navigationStatus, setNavigationStatus] = useState<string>('');
  const [isNavigating, setIsNavigating] = useState(false);

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

            // Kontrolli kas kasutaja on registreeritud trimble_ex_users tabelis
            const { data: dbUser, error: dbError } = await supabase
              .from('trimble_ex_users')
              .select('*')
              .eq('user_email', userData.email)
              .single();

            if (dbError || !dbUser) {
              console.warn('User not found in trimble_ex_users:', userData.email);
              setAuthError(`Kasutaja "${userData.email}" ei ole registreeritud. Võta ühendust administraatoriga.`);
            } else {
              console.log('User authenticated:', dbUser);
              setUser(dbUser);

              // Laadi inspekteeritud detailid ja värvi mustaks
              await loadInspectedAssemblies(connected, project.id);

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

  // Laadi inspekteeritud detailid ja värvi mustaks (optimeeritud - üks päring)
  const loadInspectedAssemblies = async (
    apiInstance: WorkspaceAPI.WorkspaceAPI,
    projId: string
  ) => {
    try {
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select('model_id, object_runtime_id')
        .eq('project_id', projId);

      if (error) throw error;

      if (inspections && inspections.length > 0) {
        console.log(`Found ${inspections.length} inspected assemblies`);

        // Grupeeri model_id järgi
        const byModel: Record<string, number[]> = {};
        for (const insp of inspections) {
          if (!byModel[insp.model_id]) {
            byModel[insp.model_id] = [];
          }
          byModel[insp.model_id].push(insp.object_runtime_id);
        }

        // Koonda kõik mudelid ühte selectorisse - ÜKS API kutse
        const modelObjectIds = Object.entries(byModel).map(([modelId, runtimeIds]) => ({
          modelId,
          objectRuntimeIds: runtimeIds
        }));

        await apiInstance.viewer.setObjectState(
          { modelObjectIds },
          { color: { r: 0, g: 0, b: 0, a: 255 } }
        );
        console.log('Inspected assemblies painted black');
      }
    } catch (e: any) {
      console.error('Failed to load inspections:', e);
    }
  };

  // Mine tagasi menüüsse
  const handleBackToMenu = () => {
    setCurrentMode(null);
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
          onSelectMode={setCurrentMode}
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
        />
        <VersionFooter />
      </>
    );
  }

  // Näita valitud inspektsiooni ekraani
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
