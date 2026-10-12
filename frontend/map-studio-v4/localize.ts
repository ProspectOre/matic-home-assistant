import type { DateFormat, Localize, NoticePlaceholders } from "./contracts";

const PREFIX = "component.matic_robot.common.";
const HA_ERROR = /^Translation error/iu;

/** A date placeholder is formatted here, with the rendering view's `dates`. */
export const translate = (
  localize: Localize | undefined,
  key: string,
  fallback: string,
  placeholders?: NoticePlaceholders,
  dates?: DateFormat,
): string => {
  const values = placeholders && Object.fromEntries(Object.entries(placeholders).map(([name, value]) =>
    [name, typeof value === "object" ? formatDateTime(value.date, dates) : value]));
  let translated: string | undefined;
  try {
    translated = localize?.(`${PREFIX}${key}`, values);
  } catch {
    translated = undefined;
  }
  if (translated && translated !== `${PREFIX}${key}` && !HA_ERROR.test(translated)) return translated;
  if (!values) return fallback;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    fallback,
  );
};

/** Joins names as the language does, e.g. "Kitchen, Hall and Bath" (home-rooms.md). */
export const formatList = (language: string, items: readonly string[]): string =>
  new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(items);

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

/**
 * Formats a valid timestamp in Home Assistant's language and time zone. A zone
 * the browser's Intl rejects is dropped for the browser's own; a rejected
 * language falls back to the browser's whole format.
 */
export const formatDateTime = (value: string, dates?: DateFormat): string => {
  const date = new Date(value);
  const format = (locale?: string, zone?: string): string =>
    new Intl.DateTimeFormat(locale, { ...DATE_TIME, timeZone: zone }).format(date);
  try {
    return format(dates?.language, dates?.timeZone);
  } catch {
    try {
      return format(dates?.language);
    } catch {
      return format();
    }
  }
};
