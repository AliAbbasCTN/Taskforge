import type { CSSProperties } from 'react';
import type { Label } from '../types/api';
import { safeColor } from '../utils/color';

/**
 * A label as a small chip: a coloured dot plus the name. The colour goes
 * through `safeColor` before reaching a `style` attribute (see its comment),
 * and the NAME is rendered as text, which React escapes - so neither can
 * carry markup.
 */
export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return (
    <span
      className="chip"
      style={{ '--chip': safeColor(label.color) } as CSSProperties}
    >
      {label.name}
    </span>
  );
}
