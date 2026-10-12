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

/** Joins names as the language does, e.g. "Kitchen, Hall and Bath" (home-rooms.md). */
export const formatList = (language: string, items: readonly string[]): string =>
  new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(items);

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/**
 * Formats a valid timestamp in Home Assistant's language and time zone, or in
 * the browser's own when its Intl rejects either of them.
 */
export const formatDateTime = (value: string, language?: string, timeZone?: string): string => {
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat(language, timeZone ? { ...DATE_TIME, timeZone } : DATE_TIME).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, DATE_TIME).format(date);
  }
};
