import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@ib/ui/lib/utils";
import { useTheme } from "@/hooks/useTheme";
import { SHOT_HEIGHT, SHOT_WIDTH, shotPath, type ShotId } from "@/welcome/shots";

/** A browser-like frame around one shot; the shot opens full size in a new tab. */
export function ShotFrame({ id, alt, className, eager = false }: { id: ShotId; alt: string; className?: string; eager?: boolean }) {
  const { i18n } = useTranslation();
  const { isDark } = useTheme();
  const src = shotPath(id, isDark ? "dark" : "light", i18n.language.startsWith("en") ? "en" : "fr");
  // Keyed by src: a theme or language switch gives the new shot a fresh chance to load.
  return <Frame key={src} src={src} alt={alt} className={className} eager={eager} />;
}

function Frame({ src, alt, className, eager }: { src: string; alt: string; className?: string; eager: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure data-testid="shot-frame" className={cn("overflow-hidden rounded-lg border border-border bg-card shadow-card", className)}>
      <div className="flex gap-1 border-b border-border px-3 py-2" aria-hidden="true">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
      </div>
      {failed ? (
        <div className="flex aspect-[16/10] items-center justify-center p-4 text-sm text-muted-foreground">{alt}</div>
      ) : (
        <a href={src} target="_blank" rel="noopener">
          <img src={src} alt={alt} width={SHOT_WIDTH} height={SHOT_HEIGHT} loading={eager ? "eager" : "lazy"} className="h-auto w-full" onError={() => setFailed(true)} />
        </a>
      )}
    </figure>
  );
}
