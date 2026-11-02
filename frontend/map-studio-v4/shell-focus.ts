export const FOCUSABLE = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

// Whether Tab reaches anything inside `root`, open shadow roots included.
export const hasFocusable = (root: ParentNode): boolean => Boolean(root.querySelector(FOCUSABLE))
  || [...root.querySelectorAll("*")].some((element) => element.shadowRoot !== null && hasFocusable(element.shadowRoot));
