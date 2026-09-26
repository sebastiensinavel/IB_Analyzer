import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { buttonVariants } from "@ib/ui/button";
import { cn } from "@ib/ui/lib/utils";

const HELP_MODES = ["manual", "agent", "server"] as const;
type HelpMode = (typeof HELP_MODES)[number];

type NodeId = "file" | "app" | "agent" | "tws" | "ib" | "server";
type EdgeId = "download" | "import" | "flexAgent" | "live" | "tws" | "flexServer" | "viaServer";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Edge {
  d: string;
  /** `text` names another edge's label, for a layout that writes it on a neighbouring path. */
  label?: { x: number; y: number; anchor?: "start" | "middle" | "end"; text?: EdgeId };
}

interface Layout {
  width: number;
  height: number;
  /** Font sizes in the drawing's own units, set so that each lands near 11–12 px on screen. */
  font: { title: number; sub: number; label: number; frame: number };
  /** The « your computer » frame, and where its name and Internet's are written. */
  frame: Box;
  computerLabel: { x: number; y: number };
  internetLabel: { x: number; y: number; anchor: "start" | "end" };
  nodes: Record<NodeId, Box>;
  edges: Record<EdgeId, Edge>;
}

/**
 * Two drawings of the same thing: side by side from a tablet up, stacked on a phone, where the
 * wide one would shrink its text below reading size. In both, every path runs the way the data
 * goes, towards the application, so the arrowhead says where a portfolio ends up; and the
 * server's path crosses the « your computer » frame, which is the point of the third mode.
 */
const LAYOUTS: Record<"wide" | "narrow", Layout> = {
  wide: {
    width: 750,
    height: 372,
    font: { title: 16, sub: 14, label: 14, frame: 13 },
    frame: { x: 10, y: 8, w: 470, h: 356 },
    computerLabel: { x: 24, y: 26 },
    internetLabel: { x: 740, y: 26, anchor: "end" },
    nodes: {
      file: { x: 40, y: 34, w: 170, h: 56 },
      app: { x: 40, y: 150, w: 170, h: 64 },
      agent: { x: 280, y: 150, w: 160, h: 64 },
      tws: { x: 280, y: 262, w: 160, h: 56 },
      ib: { x: 540, y: 34, w: 190, h: 90 },
      server: { x: 540, y: 222, w: 190, h: 64 },
    },
    edges: {
      download: { d: "M540 60 H214", label: { x: 375, y: 52 } },
      import: { d: "M125 90 V146", label: { x: 133, y: 123, anchor: "start" } },
      flexAgent: { d: "M540 108 L444 166", label: { x: 500, y: 150, anchor: "start" } },
      live: { d: "M280 182 H214", label: { x: 245, y: 140 } },
      tws: { d: "M360 262 V218" },
      viaServer: { d: "M635 286 V350 H125 V218", label: { x: 470, y: 342 } },
      flexServer: { d: "M635 124 V218", label: { x: 643, y: 176, anchor: "start" } },
    },
  },
  narrow: {
    width: 400,
    height: 430,
    font: { title: 15, sub: 12, label: 12, frame: 11 },
    frame: { x: 4, y: 124, w: 380, h: 300 },
    computerLabel: { x: 16, y: 414 },
    internetLabel: { x: 16, y: 20, anchor: "start" },
    nodes: {
      ib: { x: 10, y: 36, w: 160, h: 72 },
      server: { x: 214, y: 36, w: 160, h: 72 },
      file: { x: 10, y: 160, w: 140, h: 56 },
      agent: { x: 214, y: 160, w: 160, h: 64 },
      app: { x: 10, y: 270, w: 180, h: 64 },
      tws: { x: 214, y: 280, w: 160, h: 56 },
    },
    edges: {
      download: { d: "M70 108 V156", label: { x: 78, y: 140, anchor: "start" } },
      import: { d: "M70 216 V266", label: { x: 78, y: 246, anchor: "start" } },
      flexAgent: { d: "M150 108 V136 H294 V156", label: { x: 286, y: 152, anchor: "end" } },
      live: { d: "M214 192 H175 V266" },
      tws: { d: "M294 280 V228", label: { x: 302, y: 258, anchor: "start", text: "live" } },
      viaServer: { d: "M374 72 H392 V376 H100 V338", label: { x: 250, y: 368 } },
      flexServer: { d: "M170 72 H210", label: { x: 192, y: 28 } },
    },
  },
};

const ACTIVE: Record<HelpMode, { nodes: NodeId[]; edges: EdgeId[] }> = {
  manual: { nodes: ["ib", "file", "app"], edges: ["download", "import"] },
  agent: { nodes: ["ib", "agent", "tws", "app"], edges: ["flexAgent", "live", "tws"] },
  server: { nodes: ["ib", "server", "app"], edges: ["flexServer", "viaServer"] },
};

/** What each mode gives, in the order the list reads. `true`/`false` draw a tick or a cross. */
const FEATURES: { key: string; values: Record<HelpMode, boolean | string> }[] = [
  { key: "freshness", values: { manual: "statement", agent: "live", server: "yesterday" } },
  { key: "update", values: { manual: "byHand", agent: "automatic", server: "automatic" } },
  { key: "charts", values: { manual: false, agent: true, server: false } },
  { key: "dayValues", values: { manual: false, agent: true, server: false } },
  { key: "serverAccount", values: { manual: "notNeeded", agent: "notNeeded", server: "signIn" } },
  { key: "serverSees", values: { manual: "nothing", agent: "nothing", server: "transit" } },
];

function DiagramNode({ box, font, id, active, degraded }: { box: Box; font: Layout["font"]; id: NodeId; active: boolean; degraded: boolean }) {
  const { t } = useTranslation();
  const { x, y, w, h } = box;
  const tone = !active ? "stroke-line-2" : degraded ? "stroke-warning" : "stroke-primary";
  return (
    <g data-node={id} data-active={active} className={cn("transition-opacity duration-300", !active && "opacity-35")}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className={cn("fill-card", tone)}
        strokeWidth={active ? 1.5 : 1}
        strokeDasharray={active ? undefined : "5 4"}
      />
      <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fontSize={font.title} className="fill-foreground font-medium">
        {t(`help.modes.nodes.${id}.title`)}
      </text>
      <text x={x + w / 2} y={y + h / 2 + font.sub + 3} textAnchor="middle" fontSize={font.sub} className="fill-muted-foreground">
        {t(`help.modes.nodes.${id}.sub`)}
      </text>
    </g>
  );
}

function DiagramEdge({ edge, fontSize, id, active, degraded, markers }: { edge: Edge; fontSize: number; id: EdgeId; active: boolean; degraded: boolean; markers: string }) {
  const { t } = useTranslation();
  const { d, label } = edge;
  if (!active) return null;
  const stroke = degraded ? "stroke-warning" : "stroke-primary";
  return (
    <g data-edge={id}>
      <path
        d={d}
        fill="none"
        strokeWidth={1.75}
        strokeDasharray="7 5"
        markerEnd={`url(#${markers}-${degraded ? "degraded" : "normal"})`}
        className={cn(stroke, "motion-safe:animate-[help-flow_1s_linear_infinite]")}
      />
      {label && (
        <text
          x={label.x}
          y={label.y}
          textAnchor={label.anchor ?? "middle"}
          fontSize={fontSize}
          className={degraded ? "fill-warning" : "fill-primary"}
        >
          {t(`help.modes.edges.${label.text ?? id}`)}
        </text>
      )}
    </g>
  );
}

function Diagram({ layout, mode, className }: { layout: keyof typeof LAYOUTS; mode: HelpMode; className: string }) {
  const { t } = useTranslation();
  const { width, height, font, frame, computerLabel, internetLabel, nodes, edges } = LAYOUTS[layout];
  const active = ACTIVE[mode];
  const degraded = mode === "server";
  // One set of arrowheads per drawing: both are in the page at once, and ids must not repeat.
  const markers = `help-arrow-${layout}`;
  const frameLabel = "fill-subtle-foreground font-medium uppercase tracking-wider";

  return (
    <svg
      data-layout={layout}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={t(`help.modes.${mode}.summary`)}
      className={cn("w-full font-sans", className)}
    >
      <defs>
        {(["normal", "degraded"] as const).map((tone) => (
          <marker key={tone} id={`${markers}-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={tone === "degraded" ? "fill-warning" : "fill-primary"} />
          </marker>
        ))}
      </defs>

      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx={16} className="fill-none stroke-line-2" strokeWidth={1.5} />
      <text x={computerLabel.x} y={computerLabel.y} fontSize={font.frame} className={frameLabel}>
        {t("help.modes.frames.computer")}
      </text>
      <text x={internetLabel.x} y={internetLabel.y} textAnchor={internetLabel.anchor} fontSize={font.frame} className={frameLabel}>
        {t("help.modes.frames.internet")}
      </text>

      {(Object.keys(edges) as EdgeId[]).map((id) => (
        <DiagramEdge key={id} id={id} edge={edges[id]} fontSize={font.label} active={active.edges.includes(id)} degraded={degraded} markers={markers} />
      ))}
      {(Object.keys(nodes) as NodeId[]).map((id) => (
        <DiagramNode key={id} id={id} box={nodes[id]} font={font} active={active.nodes.includes(id)} degraded={degraded && id === "server"} />
      ))}
    </svg>
  );
}

/**
 * The three ways to run the application, one drawing: the same boxes stay in the same place
 * from one mode to the next, so what lights up and what fades is the whole explanation. The
 * agent's mode is shown first, being the one recommended; the server's is drawn in the warning
 * tone, being the fallback. Under the drawing, what each mode gives, the same rows each time.
 */
export function ModesDiagram() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<HelpMode>("agent");

  return (
    <div data-testid="help-modes" className="flex flex-col gap-3">
      <div role="group" aria-label={t("help.modes.choose")} className="grid gap-2 sm:grid-cols-3">
        {HELP_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              buttonVariants({ variant: mode === m ? "default" : "outline" }),
              "h-auto flex-col items-start gap-0 whitespace-normal px-3 py-1.5 text-left text-[13px]",
            )}
          >
            <span className="font-medium">{t(`help.modes.${m}.name`)}</span>
            <span className={cn("text-[11px] font-normal", mode === m ? "opacity-85" : "text-muted-foreground")}>{t(`help.modes.${m}.tag`)}</span>
          </button>
        ))}
      </div>

      <p className="text-muted-foreground sm:min-h-[3.75rem]">{t(`help.modes.${mode}.summary`)}</p>

      {/* The drawing at a fixed modest width, what the mode gives beside it on a wide screen. */}
      <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,600px)_minmax(0,1fr)]">
        <div className="w-full max-w-[600px] rounded-lg bg-muted/40 p-2">
          <Diagram layout="wide" mode={mode} className="hidden sm:block" />
          <Diagram layout="narrow" mode={mode} className="mx-auto max-w-[400px] sm:hidden" />
        </div>

        <ul data-testid="help-modes-features" className="flex flex-col">
          {FEATURES.map(({ key, values }) => {
            const value = values[mode];
            return (
              <li key={key} data-feature={key} className="flex items-baseline justify-between gap-3 border-b border-sep py-1.5 last:border-b-0">
                <span className="text-muted-foreground">{t(`help.modes.features.${key}`)}</span>
                {typeof value === "boolean" ? (
                  <span data-value={value} className={cn("inline-flex items-center gap-1 font-medium", value ? "text-success" : "text-destructive")}>
                    {value ? <Check aria-hidden className="size-4 self-center" /> : <X aria-hidden className="size-4 self-center" />}
                    {t(value ? "help.modes.values.yes" : "help.modes.values.no")}
                  </span>
                ) : (
                  <span className="text-right font-medium">{t(`help.modes.values.${value}`)}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
