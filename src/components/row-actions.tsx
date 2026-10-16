"use client";
import { useEffect, useId, useRef } from "react";
export default function RowActions({
  canArchive = true,
  company,
  archived,
  disabled,
  onEdit,
  onHistory,
  onArchive,
}: {
  canArchive?: boolean;
  company: string;
  archived: boolean;
  disabled: boolean;
  onEdit: () => void;
  onHistory: () => void;
  onArchive: () => void;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = () => menu.current?.hidePopover();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);
  function run(action: () => void) {
    menu.current?.hidePopover();
    action();
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        popoverTarget={id}
        aria-label={"More actions for " + company}
        className="row-more-trigger"
      >
        More <span aria-hidden="true">⋯</span>
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        className="row-actions-popover"
        onBeforeToggle={(e) => {
          if ((e.nativeEvent as ToggleEvent).newState !== "open") return;
          const r = trigger.current?.getBoundingClientRect();
          if (r && menu.current) {
            menu.current.style.top =
              Math.max(
                8,
                r.bottom + 152 > window.innerHeight
                  ? r.top - 148
                  : r.bottom + 6,
              ) + "px";
            menu.current.style.left =
              Math.max(8, Math.min(window.innerWidth - 180, r.right - 168)) +
              "px";
          }
        }}
      >
        <button type="button" onClick={() => run(onEdit)}>
          Edit details
        </button>
        <button type="button" onClick={() => run(onHistory)}>
          History
        </button>
        <button
          type="button"
          disabled={disabled || !canArchive}
          onClick={() => run(onArchive)}
        >
          {archived ? "Restore" : "Archive"}
        </button>
      </div>
    </>
  );
}
