/** A no-break space: keeps the two words around it on one line. */
const NBSP = " ";

/** Units a number is written with in a note: "42 mm", "0.2 mm", "10 g", "2 h", "215 °C", "15 %", "3 x". */
const UNIT = /(\d) (?=(?:µm|mm|cm|m|mg|g|kg|ml|l|h|min|s|ms|in|ft|x|×|%|°[CF]?)(?![\p{L}\d]))/gu;

/** A number kept on the same line as its unit, so a note never breaks "42 / mm grid". */
export function keepUnits(text: string): string {
  return text.replace(UNIT, `$1${NBSP}`);
}
