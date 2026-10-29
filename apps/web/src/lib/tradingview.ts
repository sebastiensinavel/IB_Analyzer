/**
 * L'export vers TradingView (sous-projet 44) : la liste de surveillance des titres détenus et un
 * indicateur Pine Script qui trace leurs niveaux. Pur : le chargement des comptes vit dans
 * `export/loadExport.ts`, les mots de l'étiquette viennent de l'i18n.
 */
import type { ChartLevel } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { labelInk } from "@/lib/chartLevels";
import { indexExchangeOf } from "@/lib/marketIndices";

export type ExportLevelKind = "shares" | "shortPut" | "shortCall" | "condor" | "alert";

/** Un prix à tracer sur le graphe d'un ticker ; `quantity` est `null` pour un seuil d'alerte. */
export interface ExportLevel {
  ticker: string;
  kind: ExportLevelKind;
  price: number;
  quantity: number | null;
}

export type ExportLevelWords = Record<ExportLevelKind, string>;

/** `BRK B` → `BRK.B` : TradingView écrit la classe d'actions au point, IB à l'espace. */
export function pineKey(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\s+/g, ".");
}

/** Le symbole à importer : nu, sauf un indice, préfixé de sa place pour ne jamais tomber sur un homonyme. */
export function tradingViewSymbol(ticker: string): string {
  const exchange = indexExchangeOf(ticker.trim());
  return exchange ? `${exchange}:${pineKey(ticker)}` : pineKey(ticker);
}

/** Le contenu du `.txt` d'import de liste de TradingView : une ligne, virgules, sans doublon, trié. */
export function watchlistText(tickers: Iterable<string>): string {
  return [...new Set([...tickers].map(tradingViewSymbol))].sort().join(",");
}

/**
 * Les niveaux d'un graphe de l'application qui ont un prix : un achat LEAPS n'en a pas (il se lit
 * sur la barre de son jour), un condor en a quatre, ses strikes.
 */
export function exportLevelsOf(ticker: string, levels: readonly ChartLevel[]): ExportLevel[] {
  return levels.flatMap((level): ExportLevel[] => {
    if (level.kind === "leapsBuy") return [];
    if (level.kind === "condor") {
      return [...level.putStrikes, ...level.callStrikes].map((price) => ({ ticker, kind: "condor", price, quantity: level.quantity }));
    }
    return [{ ticker, kind: level.kind, price: level.price, quantity: level.quantity }];
  });
}

/** Un niveau par ticker, nature et prix : les quantités de plusieurs comptes s'additionnent. Ordre de première apparition. */
export function mergeExportLevels(levels: readonly ExportLevel[]): ExportLevel[] {
  const merged = new Map<string, ExportLevel>();
  for (const level of levels) {
    const key = `${level.ticker}|${level.kind}|${level.price}`;
    const current = merged.get(key);
    if (current === undefined) merged.set(key, { ...level });
    else if (current.quantity !== null && level.quantity !== null) current.quantity += level.quantity;
  }
  return [...merged.values()];
}

/** `17.5`, `16.13` : deux décimales au plus, au point, la seule écriture que Pine lit. */
function pineNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

function pineString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const SERIES_INDEX: Record<Exclude<ExportLevelKind, "alert">, number> = { shares: 0, shortCall: 1, shortPut: 2, condor: 0 };

function colorOf(kind: ExportLevelKind): string {
  const palette = CHART_COLORS.dark;
  return kind === "alert" ? palette.warning : palette.series[SERIES_INDEX[kind]];
}

function levelCall(level: ExportLevel, words: ExportLevelWords): string {
  const price = pineNumber(level.price);
  const text = level.quantity === null ? `${words[level.kind]} ${price}` : `${price} ${words[level.kind]}: ${pineNumber(level.quantity)}`;
  const color = colorOf(level.kind);
  const style = level.kind === "alert" ? "line.style_dotted" : "line.style_solid";
  return `level(${price}, ${color}, ${style}, ${pineString(text)}, ${labelInk(color)})`;
}

/**
 * Un indicateur Pine v6 qui, au dernier bar, trace les niveaux du titre affiché : une branche par
 * ticker sur `syminfo.ticker`, tickers triés. Figé à sa génération : il se recolle quand les
 * positions changent.
 */
export function pineScript(levels: readonly ExportLevel[], words: ExportLevelWords, title = "IB Analyzer"): string {
  const byTicker = new Map<string, ExportLevel[]>();
  for (const level of levels) {
    const key = pineKey(level.ticker);
    byTicker.set(key, [...(byTicker.get(key) ?? []), level]);
  }
  const branches = [...byTicker.keys()].sort().map((ticker, index) => {
    const calls = byTicker.get(ticker)!.map((level) => `        ${levelCall(level, words)}`);
    return [`    ${index === 0 ? "if" : "else if"} syminfo.ticker == ${pineString(ticker)}`, ...calls].join("\n");
  });
  return [
    "//@version=6",
    `indicator(${pineString(title)}, overlay = true, max_lines_count = 500, max_labels_count = 500)`,
    "",
    "var array<line> drawnLines = array.new<line>()",
    "var array<label> drawnLabels = array.new<label>()",
    "",
    "level(float price, color tint, string style, string txt, color ink) =>",
    "    drawnLines.push(line.new(bar_index, price, bar_index + 1, price, extend = extend.both, color = tint, style = style, width = 1))",
    "    drawnLabels.push(label.new(bar_index + 3, price, txt, style = label.style_label_left, color = tint, textcolor = ink, size = size.small))",
    "",
    "if barstate.islast",
    "    for l in drawnLines",
    "        line.delete(l)",
    "    drawnLines.clear()",
    "    for b in drawnLabels",
    "        label.delete(b)",
    "    drawnLabels.clear()",
    ...branches,
    "",
  ].join("\n");
}
