import { useEffect, useState } from 'react';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';
import LoginScreen from './components/LoginScreen';
import InspectorScreen from './components/InspectorScreen';
import { supabase, User } from './supabase';
import './App.css';

export default function App() {
  const [api, setApi] = useState<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');

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

        // Värvi kõik detailid valgeks
        await paintAllWhite(connected);

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

  // Värvi kõik detailid valgeks
  const paintAllWhite = async (apiInstance: WorkspaceAPI.WorkspaceAPI) => {
    try {
      await apiInstance.viewer.setObjectState(undefined, {
        color: { r: 255, g: 255, b: 255, a: 255 }
      });
      console.log('✅ All objects painted white');
    } catch (e: any) {
      console.error('Paint white failed:', e);
    }
  };

  // Laadi inspekteeritud detailid ja värvi mustaks
  const loadInspectedAssemblies = async (
    apiInstance: WorkspaceAPI.WorkspaceAPI,
    projId: string
  ) => {
    try {
      const { data: inspections, error } = await supabase
        .from('inspections')
        .select('*')
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

        // Värvi iga mudeli inspekteeritud detailid mustaks
        for (const [modelId, runtimeIds] of Object.entries(byModel)) {
          const selector = {
            modelObjectIds: [{ modelId, objectRuntimeIds: runtimeIds }]
          };
          await apiInstance.viewer.setObjectState(selector, {
            color: { r: 0, g: 0, b: 0, a: 255 }
          });
        }
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

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Ühendatakse Trimble Connect'iga...</div>
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
      </div>
    );
  }

  if (!api) {
    return <div className="container">API pole saadaval</div>;
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <InspectorScreen
      api={api}
      user={user}
      projectId={projectId}
      onLogout={handleLogout}
    />
  );
}
