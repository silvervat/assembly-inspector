import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase';
import * as WorkspaceAPI from 'trimble-connect-workspace-api';

interface NavigationCommand {
  id: string;
  user_id: string;
  project_id: string;
  model_id: string;
  guid: string | null;
  guid_ifc: string | null;
  assembly_mark: string | null;
  object_runtime_id: string | null;
  client_timestamp: number;
  processed: boolean;
  created_at: string;
}

interface UseEos2NavigationOptions {
  api: WorkspaceAPI.WorkspaceAPI;
  projectId: string;
  enabled?: boolean;
  pollInterval?: number;
  onNavigationStart?: () => void;
  onNavigationSuccess?: (command: NavigationCommand) => void;
  onNavigationError?: (error: Error, command: NavigationCommand) => void;
}

export function useEos2Navigation({
  api,
  projectId,
  enabled = true,
  pollInterval = 2000,
  onNavigationStart,
  onNavigationSuccess,
  onNavigationError
}: UseEos2NavigationOptions) {
  const lastProcessedIdRef = useRef<string | null>(null);
  const isProcessingRef = useRef(false);

  // Process navigation command
  const processCommand = useCallback(async (command: NavigationCommand) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    try {
      onNavigationStart?.();

      const guidToUse = command.guid || command.guid_ifc;

      if (!guidToUse) {
        console.warn('[EOS2 Nav] No GUID in command, cannot auto-navigate');
        return;
      }

      console.log('[EOS2 Nav] Processing command:', command);
      console.log('[EOS2 Nav] Searching for GUID:', guidToUse);

      // Convert GUID to runtime ID and zoom to element
      const runtimeIds = await api.viewer.convertToObjectRuntimeIds(command.model_id, [guidToUse]);

      if (!runtimeIds || runtimeIds.length === 0 || !runtimeIds[0]) {
        throw new Error('GUID not found in model');
      }

      console.log('[EOS2 Nav] Found runtime ID:', runtimeIds[0]);

      const modelObjectIds = [{
        modelId: command.model_id,
        objectRuntimeIds: runtimeIds.filter(id => id != null) as number[]
      }];

      // Select using model object IDs
      await api.viewer.setSelection({ modelObjectIds }, 'set');

      // Zoom to selection using setCamera with ObjectSelector
      // This automatically fits the camera to show all selected objects
      await api.viewer.setCamera({ modelObjectIds }, { animationTime: 300 });

      console.log('[EOS2 Nav] Selected and zoomed');
      onNavigationSuccess?.(command);

      // Mark command as processed
      await supabase
        .from('navigation_commands')
        .update({
          processed: true,
          processed_at: new Date().toISOString()
        })
        .eq('id', command.id);

      lastProcessedIdRef.current = command.id;

    } catch (error) {
      console.error('[EOS2 Nav] Navigation failed:', error);
      onNavigationError?.(error as Error, command);
    } finally {
      isProcessingRef.current = false;
    }
  }, [api, onNavigationStart, onNavigationSuccess, onNavigationError]);

  // Poll for new commands
  useEffect(() => {
    if (!enabled || !projectId) return;

    const checkForCommands = async () => {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Query for unprocessed commands
        const { data: commands, error } = await supabase
          .from('navigation_commands')
          .select('*')
          .eq('user_id', user.id)
          .eq('project_id', projectId)
          .eq('processed', false)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error) {
          console.error('[EOS2 Nav] Query error:', error);
          return;
        }

        if (commands && commands.length > 0) {
          const command = commands[0] as NavigationCommand;

          // Skip if already processed this command
          if (command.id === lastProcessedIdRef.current) return;

          // Process the command
          await processCommand(command);
        }
      } catch (error) {
        console.error('[EOS2 Nav] Poll error:', error);
      }
    };

    // Initial check
    checkForCommands();

    // Set up polling
    const interval = setInterval(checkForCommands, pollInterval);

    return () => clearInterval(interval);
  }, [enabled, projectId, pollInterval, processCommand]);

  // Manual trigger
  const checkNow = useCallback(async () => {
    // Force immediate check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: commands } = await supabase
      .from('navigation_commands')
      .select('*')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .eq('processed', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (commands && commands.length > 0) {
      await processCommand(commands[0] as NavigationCommand);
    }
  }, [projectId, processCommand]);

  return { checkNow };
}
