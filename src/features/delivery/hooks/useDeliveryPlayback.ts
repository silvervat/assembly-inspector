import { useState, useCallback, useRef } from 'react';

type PlaybackMode = 'vehicle' | 'date';

interface PlaybackSettings {
  playbackMode: PlaybackMode;
  expandItemsDuringPlayback: boolean;
  showVehicleOverview: boolean;
  disableZoom: boolean;
  selectItemsInModel: boolean;
}

const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  playbackMode: 'vehicle',
  expandItemsDuringPlayback: true,
  showVehicleOverview: false,
  disableZoom: false,
  selectItemsInModel: true,
};

export function useDeliveryPlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(800);
  const [currentPlaybackVehicleId, setCurrentPlaybackVehicleId] = useState<string | null>(null);
  const [currentPlaybackDate, setCurrentPlaybackDate] = useState<string | null>(null);
  const [playbackSettings, setPlaybackSettings] = useState<PlaybackSettings>(DEFAULT_PLAYBACK_SETTINGS);
  const [playbackVehicleColors, setPlaybackVehicleColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [playbackDateColors, setPlaybackDateColors] = useState<Record<string, { r: number; g: number; b: number }>>({});
  const [playbackColoredDates, setPlaybackColoredDates] = useState<Set<string>>(new Set());
  const [playbackColoredVehicles, setPlaybackColoredVehicles] = useState<Set<string>>(new Set());
  const playbackAbortRef = useRef(false);

  const stopPlayback = useCallback(() => {
    playbackAbortRef.current = true;
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentPlaybackVehicleId(null);
    setCurrentPlaybackDate(null);
  }, []);

  const pausePlayback = useCallback(() => {
    setIsPaused(true);
  }, []);

  return {
    isPlaying, setIsPlaying,
    isPaused, setIsPaused,
    playbackSpeed, setPlaybackSpeed,
    currentPlaybackVehicleId, setCurrentPlaybackVehicleId,
    currentPlaybackDate, setCurrentPlaybackDate,
    playbackSettings, setPlaybackSettings,
    playbackVehicleColors, setPlaybackVehicleColors,
    playbackDateColors, setPlaybackDateColors,
    playbackColoredDates, setPlaybackColoredDates,
    playbackColoredVehicles, setPlaybackColoredVehicles,
    playbackAbortRef,
    stopPlayback, pausePlayback,
  };
}
