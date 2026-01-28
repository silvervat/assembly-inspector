import { useState, useCallback } from 'react';
import type { DeliveryItem, DeliveryVehicle } from '../../../supabase';

export function useDeliveryDragDrop() {
  const [isDragging, setIsDragging] = useState(false);
  const [draggedItems, setDraggedItems] = useState<DeliveryItem[]>([]);
  const [draggedVehicle, setDraggedVehicle] = useState<DeliveryVehicle | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [dragOverVehicleId, setDragOverVehicleId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragOverVehicleIndex, setDragOverVehicleIndex] = useState<number | null>(null);

  const resetDragState = useCallback(() => {
    setIsDragging(false);
    setDraggedItems([]);
    setDraggedVehicle(null);
    setDragOverDate(null);
    setDragOverVehicleId(null);
    setDragOverIndex(null);
    setDragOverVehicleIndex(null);
  }, []);

  return {
    isDragging, setIsDragging,
    draggedItems, setDraggedItems,
    draggedVehicle, setDraggedVehicle,
    dragOverDate, setDragOverDate,
    dragOverVehicleId, setDragOverVehicleId,
    dragOverIndex, setDragOverIndex,
    dragOverVehicleIndex, setDragOverVehicleIndex,
    resetDragState,
  };
}
