/**
 * Delivery Schedule Helper Functions
 * Shared utility functions for delivery schedule formatting and calculations
 */

// Format date with weekday name (DD.MM.YY Weekday)
export const formatDateWithDay = (dateStr: string, weekdayNames: string[]): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year).slice(-2);
  const weekday = weekdayNames[date.getDay()];
  return `${dayStr}.${monthStr}.${yearStr} ${weekday}`;
};

// Get ISO week number
export const getISOWeek = (date: Date): number => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

// Format weight
export const formatWeight = (weight: string | number | null | undefined): { kg: string; tons: string } | null => {
  if (!weight) return null;
  const kgValue = typeof weight === 'string' ? parseFloat(weight) : weight;
  if (isNaN(kgValue)) return null;
  const roundedKg = Math.round(kgValue);
  const tons = kgValue / 1000;
  return {
    kg: `${roundedKg} kg`,
    tons: `${tons >= 10 ? Math.round(tons) : tons.toFixed(1)}t`
  };
};

// Format duration in minutes to display string
export const formatDuration = (minutes: number | null | undefined): string => {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, '0')}min`;
};

// Get day name only
export const getDayNameFromDate = (dateStr: string, weekdayNames: string[]): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return weekdayNames[date.getDay()];
};

// Format date as DD.MM.YY only (without day name)
export const formatDateShort = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dayStr = String(day).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  const yearStr = String(year).slice(-2);
  return `${dayStr}.${monthStr}.${yearStr}`;
};

// Format date for DB (YYYY-MM-DD)
export const formatDateForDB = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Format date for display/export (DD.MM.YYYY)
export const formatDateDisplay = (dateStr: string): string => {
  if (!dateStr || dateStr === '-') return dateStr;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
};

// Format time without seconds (HH:MM)
export const formatTimeDisplay = (timeStr: string | null | undefined): string => {
  if (!timeStr) return '-';
  return timeStr.slice(0, 5);
};

// Natural sort helper for vehicle codes (EBE-8, EBE-9, EBE-10 instead of EBE-10, EBE-8, EBE-9)
export const naturalSortVehicleCode = (a: string | undefined, b: string | undefined): number => {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const regex = /^(.*?)(\d+)$/;
  const matchA = a.match(regex);
  const matchB = b.match(regex);

  if (matchA && matchB) {
    const prefixCompare = matchA[1].localeCompare(matchB[1]);
    if (prefixCompare !== 0) return prefixCompare;
    return parseInt(matchA[2], 10) - parseInt(matchB[2], 10);
  }

  return a.localeCompare(b);
};

// Get text color (black or white) based on background RGB
export const getTextColor = (r: number, g: number, b: number): string => {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 155 ? '#000000' : '#ffffff';
};
