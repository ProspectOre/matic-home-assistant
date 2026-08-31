import type { Localize } from "./contracts";

const PREFIX = "component.matic_robot.common.";

export const translate = (
  localize: Localize | undefined,
  key: string,
  fallback: string,
  placeholders?: Readonly<Record<string, string | number>>,
): string => {
  const values = placeholders ? { ...placeholders } : undefined;
  const translated = localize?.(`${PREFIX}${key}`, values);
  if (translated && translated !== `${PREFIX}${key}`) return translated;
  if (!placeholders) return fallback;
  return Object.entries(placeholders).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    fallback,
  );
};
