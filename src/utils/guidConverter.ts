/**
 * GUID conversion utilities
 * Converts between MS GUID (UUID format) and IFC GUID (22 chars)
 */

const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/**
 * Convert MS GUID (UUID format) to IFC GUID (22 chars)
 * MS GUID → 128 bits → IFC GUID
 */
export function msToIfcGuid(msGuid: string): string {
  if (!msGuid) return '';

  const hex = msGuid.replace(/-/g, '').toLowerCase();
  if (hex.length !== 32 || !/^[0-9a-f]+$/.test(hex)) return '';

  let bits = '';
  for (const char of hex) {
    bits += parseInt(char, 16).toString(2).padStart(4, '0');
  }

  let ifcGuid = '';
  ifcGuid += IFC_GUID_CHARS[parseInt(bits.slice(0, 2), 2)];
  for (let i = 2; i < 128; i += 6) {
    ifcGuid += IFC_GUID_CHARS[parseInt(bits.slice(i, i + 6), 2)];
  }

  return ifcGuid;
}
