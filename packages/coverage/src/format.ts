/** Strips trailing zeros from a decimal string, then a now-trailing dot. */
function stripTrailingZeros(text: string): string {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/**
 * Python's f"{value:g}" for the numbers a strike or a share count takes,
 * wrapped in `_fmt_num`'s integer short-circuit: an integral value — `-0`
 * included — prints as a plain integer, never through `:g` (which would
 * turn e.g. 1234567 into "1.23457e+06"). For the rest: six significant
 * digits, ties broken to even (Python's rounding, not `toFixed`'s or
 * `toPrecision`'s round-half-up), fixed notation when the *rounded*
 * exponent falls in [-4, 6) — rounding a tie can carry the sixth digit out
 * and cross a decade boundary either way — scientific notation otherwise,
 * with no trailing zeros in the mantissa. `""` for null, as `_fmt_num(None)`.
 */
export function fmtNum(value: number | null): string {
  if (value === null) return "";
  if (Number.isInteger(value)) return String(value);

  const negative = value < 0;
  const magnitude = Math.abs(value);

  // 21 significant digits: enough to see a tie at six significant digits
  // exactly, since a double can never sit closer to the halfway point than
  // digit 7 being "5" followed by fourteen zeros through digit 21.
  const [mantissaStr, expStr] = magnitude.toExponential(20).split("e");
  let exponent = Number(expStr);
  const digits = mantissaStr.replace(".", "");

  const kept = digits.slice(0, 6).split("").map(Number);
  const tail = digits.slice(6);
  const isTie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
  const roundUp = isTie ? kept[5] % 2 === 1 : Number(tail[0]) >= 5;

  if (roundUp) {
    let i = 5;
    while (i >= 0 && ++kept[i] === 10) {
      kept[i] = 0;
      i--;
    }
    if (i < 0) {
      // Carried past the leading digit (999999 -> 1000000): keep six
      // significant digits, bump the exponent instead of adding a seventh.
      kept.unshift(1);
      kept.pop();
      exponent += 1;
    }
  }
  const digitStr = kept.join("");

  if (exponent < -4 || exponent >= 6) {
    const mantissa = stripTrailingZeros(`${digitStr[0]}.${digitStr.slice(1)}`);
    const sign = exponent < 0 ? "-" : "+";
    const expDigits = String(Math.abs(exponent)).padStart(2, "0");
    return `${negative ? "-" : ""}${mantissa}e${sign}${expDigits}`;
  }

  const pointPos = exponent + 1;
  const text =
    pointPos <= 0
      ? `0.${"0".repeat(-pointPos)}${digitStr}`
      : digitStr.slice(pointPos)
        ? `${digitStr.slice(0, pointPos)}.${digitStr.slice(pointPos)}`
        : digitStr.slice(0, pointPos);
  return `${negative ? "-" : ""}${stripTrailingZeros(text)}`;
}

/**
 * Python's f"{value:.2f}". Both languages round the exact binary value
 * correctly; they differ only on an exact tie, which Python rounds to even
 * and `toFixed` rounds up. A tie at two decimals is exactly an odd multiple
 * of 1/8 (0.125, 2.375…), and `value * 8` is exact for any double.
 */
export function fmtFixed2(value: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const eighths = magnitude * 8;
  let text: string;
  if (Number.isInteger(eighths) && eighths % 2 === 1) {
    const floor = Math.floor(magnitude * 100);
    const cents = floor % 2 === 0 ? floor : floor + 1;
    text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  } else {
    text = magnitude.toFixed(2);
  }
  return negative ? `-${text}` : text;
}

/** Python's f"{value:,.2f}". */
export function fmtMoney(value: number): string {
  const [whole, fraction] = fmtFixed2(value).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
