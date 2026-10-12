import type { Localize } from "./contracts";

const PREFIX = "component.matic_robot.common.";
const HA_ERROR = /^Translation error/iu;

export const translate = (
  localize: Localize | undefined,
  key: string,
  fallback: string,
  placeholders?: Readonly<Record<string, string | number>>,
): string => {
  const values = placeholders ? { ...placeholders } : undefined;
  let translated: string | undefined;
  try {
    translated = localize?.(`${PREFIX}${key}`, values);
  } catch {
    translated = undefined;
  }
  if (translated && translated !== `${PREFIX}${key}` && !HA_ERROR.test(translated)) return translated;
  if (!placeholders) return fallback;
  return Object.entries(placeholders).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    fallback,
  );
};
