import * as Tooltip from "@radix-ui/react-tooltip";

const defaultContentClass =
  "z-[100] max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-snug text-slate-800 shadow-lg outline-none";

/**
 * Infobulle (Radix) — apparaît immédiatement au survol. Envelopper l’app avec `TooltipProvider` (main.jsx).
 */
export function Infobulle({
  children,
  content,
  side = "top",
  align = "center",
  className: triggerClassName = "",
  contentClassName = "",
  disabled = false,
  /** "dotted" (défaut) ou "plain" (curseur d’aide seulement) */
  touchStyle = "dotted",
}) {
  if (disabled || content == null) {
    return children;
  }
  const touchClass =
    touchStyle === "plain"
      ? "cursor-help"
      : "cursor-help underline decoration-dotted decoration-slate-400/90 underline-offset-2";
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className={[touchClass, "text-inherit", triggerClassName].filter(Boolean).join(" ")}
        >
          {children}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className={`${defaultContentClass} ${contentClassName}`}
          side={side}
          align={align}
          sideOffset={6}
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function TooltipProvider({ children }) {
  return <Tooltip.Provider delayDuration={0}>{children}</Tooltip.Provider>;
}
