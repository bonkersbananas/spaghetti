/**
 * A date formatter that is made once per set of options. `date.toLocaleDateString(undefined, options)` builds a new
 * Intl.DateTimeFormat on every call, which costs a few hundred microseconds (a millisecond or two on a phone): a
 * journal page formats dozens of dates, and the Journal tab spent 40 ms of a 4×-throttled tap on it.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, options);
    formatters.set(key, format);
  }
  return format;
}
