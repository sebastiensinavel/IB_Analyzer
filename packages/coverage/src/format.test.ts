import { describe, expect, it } from "vitest";
import { fmtFixed2, fmtMoney, fmtNum } from "./format.ts";

// These three reproduce Python's f"{x:g}", f"{x:.2f}" and f"{x:,.2f}": the
// strings they build end up in the RiskReport, character for character.
describe("fmtNum (Python :g)", () => {
  it.each([
    [150, "150"],
    [452.5, "452.5"],
    [2.5, "2.5"],
    [0.5, "0.5"],
    [100, "100"],
    [12.345678, "12.3457"],
    [1234567, "1234567"],
    [1234567.5, "1.23457e+06"],
    [0.00001234, "1.234e-05"],
    [-7.25, "-7.25"],
    // Ties at the sixth significant digit round to even, like Python's
    // `:g` — not up, like `toFixed` or naive `toPrecision`.
    [123456.5, "123456"],
    [100000.5, "100000"],
    [12345.25, "12345.2"],
    [-123456.5, "-123456"],
    // A tie (or a value just past one) can round the sixth digit's carry
    // all the way out, crossing into scientific notation.
    [999999.5, "1e+06"],
    [999999.6, "1e+06"],
    [9.9999995e-5, "0.0001"],
    [0.000123456789, "0.000123457"],
    // Not a tie: the digits past the sixth are "5.5", which is > half.
    [1234565.5, "1.23457e+06"],
    // Rounds down; trailing zeros are stripped.
    [1.0000005, "1"],
    // The integer short-circuit in `_fmt_num`, not `:g` itself: an
    // integral value never goes through scientific notation, and -0 is
    // integral too.
    [-0, "0"],
  ])("formats %s as %s", (value, expected) => {
    expect(fmtNum(value)).toBe(expected);
  });

  it("formats null as an empty string, like _fmt_num(None)", () => {
    expect(fmtNum(null)).toBe("");
  });
});

describe("fmtFixed2 (Python :.2f)", () => {
  it.each([
    [140, "140.00"],
    [165.5, "165.50"],
    [1.005, "1.00"],
    [2.675, "2.67"],
    [0.145, "0.14"],
    [-3.5, "-3.50"],
    [-0.001, "-0.00"],
  ])("rounds %s to %s like Python", (value, expected) => {
    expect(fmtFixed2(value)).toBe(expected);
  });

  it.each([
    [0.125, "0.12"],
    [0.375, "0.38"],
    [0.625, "0.62"],
    [0.875, "0.88"],
    [1234.125, "1234.12"],
    [-0.625, "-0.62"],
  ])("rounds the exact tie %s to even (%s)", (value, expected) => {
    expect(fmtFixed2(value)).toBe(expected);
  });

  // Where rounding to even and rounding half up actually disagree. On the
  // other exact ties above (0.375, 0.875) both conventions round up, so they
  // cannot witness the difference — asserting it there would be a false test.
  it.each([0.125, 0.625, 1234.125, -0.625])("differs from toFixed on the tie %s", (value) => {
    expect(fmtFixed2(value)).not.toBe(value.toFixed(2));
  });
});

describe("fmtMoney (Python :,.2f)", () => {
  it.each([
    [0, "0.00"],
    [999.5, "999.50"],
    [1000, "1,000.00"],
    [20000, "20,000.00"],
    [1234567.891, "1,234,567.89"],
    [-1234.5, "-1,234.50"],
  ])("formats %s as %s", (value, expected) => {
    expect(fmtMoney(value)).toBe(expected);
  });
});
