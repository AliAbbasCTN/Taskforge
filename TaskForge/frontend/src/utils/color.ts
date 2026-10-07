const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const FALLBACK = '#7b869c';

/**
 * WHAT: Returns `color` if it is a plain `#RRGGBB` value, otherwise a neutral
 * grey.
 *
 * WHY: a label's colour ends up inside a `style` attribute. The backend only
 * ever stores validated hex colours, but the frontend should not rely on that
 * alone - values from anywhere (a future API change, a bug, a tampered
 * response) must never be able to inject CSS. Checking at the point of use is
 * cheap defence in depth.
 */
export function safeColor(color: string): string {
  return HEX_COLOR.test(color) ? color : FALLBACK;
}
