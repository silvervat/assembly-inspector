import { useEffect, useState } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import LoginScreen from './components/LoginScreen';
import InspectorScreen from './components/InspectorScreen';
import { supabase, User } from './supabase';
import './App.css';

export const APP_VERSION = '1.5.0';

export default function App() {
  const [api, setApi] = useState<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [tcUserEmail, setTcUserEmail] = useState<string>('');

  // Ühenduse loomine Trimble Connect'iga
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

        // Hangi Trimble Connect kasutaja email
        try {
          const tcUser = await connected.user.getUser();
          if (tcUser.email) {
            setTcUserEmail(tcUser.email);
            console.log('TC User email:', tcUser.email);
          }
        } catch (e) {
          console.warn('Could not get TC user:', e);
        }

        // Laadi inspekteeritud detailid ja värvi mustaks
        await loadInspectedAssemblies(connected, project.id);

        setLoading(false);
      } catch (err: any) {
        setError(err?.message || 'Ühenduse viga Trimble Connect\'iga');
        console.error('Connection error:', err);
        setLoading(false);
      }
    }
    init();
  }, []);

  // Kontrolli kas kasutaja on juba sisse loginud (localStorage)
  useEffect(() => {
    const storedUser = localStorage.getItem('inspector_user');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser);
        setUser(parsed);
      } catch (e) {
        localStorage.removeItem('inspector_user');
      }
    }
  }, []);

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
        console.log('✅ Inspected assemblies painted black');
      }
    } catch (e: any) {
      console.error('Failed to load inspections:', e);
    }
  };

  // Login handler
  const handleLogin = async (pin: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('pin_code', pin)
        .single();

      if (error || !data) {
        throw new Error('Vale PIN kood');
      }

      setUser(data);
      localStorage.setItem('inspector_user', JSON.stringify(data));
    } catch (err: any) {
      throw err;
    }
  };

  // Logout handler
  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('inspector_user');
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

  if (!user) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} />
        <VersionFooter />
      </>
    );
  }

  return (
    <>
      <InspectorScreen
        api={api}
        user={user}
        projectId={projectId}
        tcUserEmail={tcUserEmail}
        onLogout={handleLogout}
      />
      <VersionFooter />
    </>
  );
}
