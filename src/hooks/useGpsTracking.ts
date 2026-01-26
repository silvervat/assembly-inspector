/**
 * GPS Tracking Hook
 * Provides real-time GPS position tracking with accuracy and signal quality
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface GpsPosition {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

export type GpsSignalQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'none';

export interface GpsTrackingState {
  position: GpsPosition | null;
  error: string | null;
  isTracking: boolean;
  signalQuality: GpsSignalQuality;
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'unknown';
  lastUpdateAge: number; // seconds since last update
}

interface UseGpsTrackingOptions {
  enableHighAccuracy?: boolean;
  maxAge?: number; // milliseconds
  timeout?: number; // milliseconds
  updateInterval?: number; // milliseconds for UI updates
}

const DEFAULT_OPTIONS: UseGpsTrackingOptions = {
  enableHighAccuracy: true,
  maxAge: 5000,
  timeout: 10000,
  updateInterval: 1000
};

/**
 * Determine signal quality based on accuracy
 */
function getSignalQuality(accuracy: number | null, lastUpdate: number | null): GpsSignalQuality {
  if (!lastUpdate || !accuracy) return 'none';

  const ageSeconds = (Date.now() - lastUpdate) / 1000;

  // If position is stale (>30 seconds), signal is poor
  if (ageSeconds > 30) return 'poor';
  if (ageSeconds > 15) return 'fair';

  // Based on accuracy in meters
  if (accuracy <= 5) return 'excellent';
  if (accuracy <= 10) return 'good';
  if (accuracy <= 20) return 'fair';
  return 'poor';
}

/**
 * Hook for real-time GPS tracking
 */
export function useGpsTracking(options: UseGpsTrackingOptions = {}): GpsTrackingState & {
  startTracking: () => void;
  stopTracking: () => void;
  requestPermission: () => Promise<boolean>;
  getCurrentPosition: () => Promise<GpsPosition | null>;
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const [position, setPosition] = useState<GpsPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [lastUpdateAge, setLastUpdateAge] = useState(0);

  const watchIdRef = useRef<number | null>(null);
  const ageIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate signal quality
  const signalQuality = getSignalQuality(
    position?.accuracy ?? null,
    position?.timestamp ?? null
  );

  // Update age counter
  useEffect(() => {
    if (isTracking && position) {
      ageIntervalRef.current = setInterval(() => {
        setLastUpdateAge(Math.floor((Date.now() - position.timestamp) / 1000));
      }, opts.updateInterval);

      return () => {
        if (ageIntervalRef.current) {
          clearInterval(ageIntervalRef.current);
        }
      };
    }
  }, [isTracking, position?.timestamp, opts.updateInterval]);

  // Check permission status on mount
  useEffect(() => {
    if ('permissions' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        setPermissionStatus(result.state as 'granted' | 'denied' | 'prompt');

        result.onchange = () => {
          setPermissionStatus(result.state as 'granted' | 'denied' | 'prompt');
        };
      }).catch(() => {
        setPermissionStatus('unknown');
      });
    }
  }, []);

  // Request permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported');
      return false;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          setPermissionStatus('granted');
          resolve(true);
        },
        (err) => {
          if (err.code === 1) {
            setPermissionStatus('denied');
            setError('GPS permission denied');
          } else {
            setError(err.message);
          }
          resolve(false);
        },
        { enableHighAccuracy: opts.enableHighAccuracy }
      );
    });
  }, [opts.enableHighAccuracy]);

  // Get current position once
  const getCurrentPosition = useCallback(async (): Promise<GpsPosition | null> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported');
      return null;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const gpsPos: GpsPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: pos.coords.altitude,
            accuracy: pos.coords.accuracy,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            timestamp: pos.timestamp
          };
          setPosition(gpsPos);
          setError(null);
          resolve(gpsPos);
        },
        (err) => {
          setError(err.message);
          resolve(null);
        },
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          maximumAge: opts.maxAge,
          timeout: opts.timeout
        }
      );
    });
  }, [opts.enableHighAccuracy, opts.maxAge, opts.timeout]);

  // Start continuous tracking
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported');
      return;
    }

    if (watchIdRef.current !== null) {
      return; // Already tracking
    }

    setIsTracking(true);
    setError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const gpsPos: GpsPosition = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp
        };
        setPosition(gpsPos);
        setError(null);
        setLastUpdateAge(0);
      },
      (err) => {
        setError(err.message);
        if (err.code === 1) {
          setPermissionStatus('denied');
        }
      },
      {
        enableHighAccuracy: opts.enableHighAccuracy,
        maximumAge: opts.maxAge,
        timeout: opts.timeout
      }
    );
  }, [opts.enableHighAccuracy, opts.maxAge, opts.timeout]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (ageIntervalRef.current) {
      clearInterval(ageIntervalRef.current);
      ageIntervalRef.current = null;
    }
    setIsTracking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (ageIntervalRef.current) {
        clearInterval(ageIntervalRef.current);
      }
    };
  }, []);

  return {
    position,
    error,
    isTracking,
    signalQuality,
    permissionStatus,
    lastUpdateAge,
    startTracking,
    stopTracking,
    requestPermission,
    getCurrentPosition
  };
}
