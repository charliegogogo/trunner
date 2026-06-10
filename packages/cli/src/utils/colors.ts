/**
 * Color utility functions for working directory output visualization.
 *
 * Colors are generated in the purple-to-blue range (HSL color space)
 * with good visual separation between working directories.
 */

/**
 * Convert HSL to RGB hex string.
 * h: 0-360, s: 0-100, l: 0-100
 * Returns: "#rrggbb"
 */
function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (v: number): string => {
    const hex = Math.round((v + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Get a color for a working directory based on its index.
 *
 * Uses a purple-to-blue hue range with maximum visual separation:
 * - Hue range: 270° (purple) → 330° (pink) → 0° (red) → 180° (cyan) → 210° (blue)
 * - Saturation: 75% (vibrant but not harsh)
 * - Lightness: 65% (readable on dark backgrounds)
 *
 * @param index - Working directory index (0-based)
 * @param total - Total number of working directories
 * @returns RGB hex color string (e.g., "#b48cff")
 */
export function getWorkingDirColor(index: number, total: number): string {
  if (total <= 0) return '#b48cff';
  if (total === 1) return '#b48cff';

  // Start at purple (270°) and distribute evenly across a wide range
  // We use a range of 300° to ensure good separation
  const startHue = 270;
  const hueRange = 300;
  const hue = (startHue + (index * hueRange) / total) % 360;

  return hslToHex(hue, 75, 65);
}

/**
 * Get ANSI escape code for a working directory color.
 * Returns the full escape sequence including reset.
 */
export function getWorkingDirAnsiColor(index: number, total: number): {
  open: string;
  close: string;
} {
  const hex = getWorkingDirColor(index, total);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  return {
    open: `\x1b[38;2;${r};${g};${b}m`,
    close: '\x1b[0m',
  };
}

/**
 * Get Ink-compatible color prop for a working directory.
 * Returns an RGB object that Ink's Text component can use.
 */
export function getWorkingDirInkColor(index: number, total: number): {
  r: number;
  g: number;
  b: number;
} {
  const hex = getWorkingDirColor(index, total);
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
