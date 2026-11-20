import { css } from "lit";
import { switchStyles } from "./switch-styles";

// The switch and the labelled field: workflow controls,
// so the lazy views carry them and startup does not. The select and the
// field's input share one rule in controls.ts, which the shell's switchers
// need too.
export const formControls = css`
.mop-setting { display: flex; align-items: center; gap: var(--ms-space-3); min-block-size: var(--ms-control); color: var(--ms-text); font-size: var(--ms-t-sm); }
.mop-setting-copy { display: grid; flex: 1; min-inline-size: 0; gap: var(--ms-space-1); overflow-wrap: anywhere; }
.mop-setting-copy small { color: var(--ms-text); font-size: var(--ms-t-xs); }
${switchStyles}
.ms-field { display: grid; gap: var(--ms-space-1); color: var(--ms-text-quiet); font-size: var(--ms-t-xs); font-weight: var(--ms-w-medium); }
/* .ms-range: 44 px tall, no UA margin (MS-RESP-09), the indicator colour. */
.ms-range { display: block; inline-size: 100%; min-block-size: var(--ms-control); margin: 0; accent-color: var(--ms-resolved-indicator, var(--ms-accent)); }
.ms-range:focus-visible { outline: 2px solid var(--ms-resolved-indicator, var(--ms-accent)); outline-offset: 2px; }
`;
