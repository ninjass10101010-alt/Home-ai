"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import WallDisplayToggle from "@/components/settings/WallDisplayToggle";
import IconButton from "@/components/ui/IconButton";
import ListRow from "@/components/ui/ListRow";
import Modal from "@/components/ui/Modal";
import SegmentedControl from "@/components/ui/SegmentedControl";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";
import Toggle from "@/components/ui/Toggle";
import { useHomeLayout } from "@/hooks/useHomeLayout";
import { useSettingsFeedback } from "@/hooks/useSettingsFeedback";
import { ALL_WIDGETS, type LayoutMode, type WidgetId } from "@/lib/layout-config";

export default function HomeSettingsSection() {
  const {
    config,
    orientation,
    visibleWidgetsFor,
    orderedWidgetsFor,
    moveUpFor,
    moveDownFor,
    reorderFor,
    toggleFor,
    resetLayout,
    setSuppressRehydrate,
  } = useHomeLayout();
  const { feedback, showFeedback } = useSettingsFeedback();
  const [selectedOrientation, setSelectedOrientation] = useState<LayoutMode | null>(null);
  const editingOrientation = selectedOrientation ?? orientation;
  const [draggingId, setDraggingId] = useState<WidgetId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<WidgetId | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const rowRefs = useRef(new Map<WidgetId, HTMLDivElement | null>());
  const previousPositions = useRef<Map<WidgetId, number> | null>(null);
  const reorderPending = useRef(false);
  const flipAnimations = useRef(new Map<WidgetId, Animation>());

  useEffect(() => {
    setSuppressRehydrate(true);
    return () => setSuppressRehydrate(false);
  }, [setSuppressRehydrate]);

  const editingOrdered = orderedWidgetsFor(editingOrientation);
  const editingOrderKey = `${editingOrientation}:${editingOrdered.map((widget) => widget.id).join("|")}`;
  const editingVisible = visibleWidgetsFor(editingOrientation);
  const hiddenIds = new Set(config[editingOrientation]?.hidden ?? []);
  const visibleCount = editingVisible.length;

  const widgetLabel = (id: WidgetId) => ALL_WIDGETS.find((widget) => widget.id === id)?.label ?? id;

  const cancelFlipAnimations = useCallback(() => {
    for (const animation of flipAnimations.current.values()) {
      animation.cancel();
    }
    flipAnimations.current.clear();
  }, []);

  const recordPositions = () => {
    cancelFlipAnimations();
    const positions = new Map<WidgetId, number>();
    for (const [id, element] of rowRefs.current) {
      if (element) positions.set(id, element.getBoundingClientRect().top);
    }
    previousPositions.current = positions;
    reorderPending.current = true;
  };

  const handleMoveUp = (id: WidgetId) => {
    recordPositions();
    moveUpFor(editingOrientation, id);
    showFeedback(`↕️ Moved ${widgetLabel(id)} up (${editingOrientation})`, "success");
  };

  const handleMoveDown = (id: WidgetId) => {
    recordPositions();
    moveDownFor(editingOrientation, id);
    showFeedback(`↕️ Moved ${widgetLabel(id)} down (${editingOrientation})`, "success");
  };

  const handleReorder = (id: WidgetId, targetIndex: number) => {
    recordPositions();
    reorderFor(editingOrientation, id, targetIndex);
    showFeedback(`↕️ Reordered ${widgetLabel(id)} (${editingOrientation})`, "success");
  };

  const handleToggle = (id: WidgetId, nextVisible: boolean) => {
    toggleFor(editingOrientation, id);
    showFeedback(
      nextVisible
        ? `✅ Showing ${widgetLabel(id)} (${editingOrientation})`
        : `🚫 Hiding ${widgetLabel(id)} (${editingOrientation})`,
      "success",
    );
  };

  const handleDragStart = (id: WidgetId) => (event: DragEvent<HTMLElement>) => {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };

  const handleDragOver = (id: WidgetId) => (event: DragEvent<HTMLElement>) => {
    if (!draggingId || draggingId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  };

  const handleDragLeave = (id: WidgetId) => () => {
    if (dropTargetId === id) setDropTargetId(null);
  };

  const handleDrop = (targetId: WidgetId) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const sourceId = (event.dataTransfer.getData("text/plain") || draggingId) as WidgetId | null;
    setDraggingId(null);
    setDropTargetId(null);
    if (!sourceId || sourceId === targetId) return;
    const targetIndex = editingOrdered.findIndex((widget) => widget.id === targetId);
    if (targetIndex === -1) return;
    handleReorder(sourceId, targetIndex);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropTargetId(null);
  };

  useEffect(() => {
    if (!reorderPending.current || !previousPositions.current) return cancelFlipAnimations;
    reorderPending.current = false;
    const previous = previousPositions.current;
    previousPositions.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return cancelFlipAnimations;
    for (const [id, element] of rowRefs.current) {
      if (!element || typeof element.animate !== "function") continue;
      const oldTop = previous.get(id);
      if (oldTop === undefined) continue;
      const newTop = element.getBoundingClientRect().top;
      const delta = oldTop - newTop;
      if (Math.abs(delta) < 1) continue;
      const animation = element.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
      flipAnimations.current.set(id, animation);
    }
    return cancelFlipAnimations;
  }, [cancelFlipAnimations, editingOrderKey]);

  const confirmReset = () => {
    resetLayout();
    showFeedback("🔄 Layout reset for phone, tablet, and desktop", "success");
    setResetOpen(false);
  };

  return (
    <section data-settings-home="true" aria-label="Home settings" className="space-y-5">
      <Toast open={feedback !== null} tone={feedback?.tone}>{feedback?.message}</Toast>
      <SectionCard title="Layout & display" description="Show, hide, and reorder Home widgets." icon="🧩" headingLevel="h2">
        <div className="space-y-3">
          <SegmentedControl
            options={[
              { id: "phone", label: "📱 Phone" },
              { id: "tablet", label: "📱 Tablet" },
              { id: "desktop", label: "🖥️ Desktop" },
            ]}
            value={editingOrientation}
            onChange={(value) => setSelectedOrientation(value as LayoutMode)}
            aria-label="Layout mode"
          />
          <p className="text-[11px] text-text-muted">
            Each orientation keeps its own order. {editingOrientation === orientation
              ? "You're editing the layout your device is using right now."
              : `Your device is in ${orientation} — the ${orientation} layout applies automatically.`}
          </p>
          <WallDisplayToggle />
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
            <span>All widgets</span>
            <span>{visibleCount} on Home</span>
          </div>
          <div className="space-y-3">
            {editingOrdered.map((widget, index) => {
              const isDropTarget = dropTargetId === widget.id && draggingId !== widget.id;
              const isHidden = hiddenIds.has(widget.id);
              const rowClassName = [
                "rounded-2xl transition",
                isDropTarget ? "ring-2 ring-[var(--color-accent-selected)] ring-offset-2 ring-offset-[var(--color-canvas)]" : "",
                draggingId === widget.id ? "border-dashed bg-[var(--color-accent-selected)]/10" : "",
                isHidden ? "border-dashed border-[var(--color-border)]" : "",
              ].filter(Boolean).join(" ");
              return (
                <div
                  key={widget.id}
                  ref={(element) => {
                    if (element) rowRefs.current.set(widget.id, element);
                    else rowRefs.current.delete(widget.id);
                  }}
                  data-widget-id={widget.id}
                  data-widget-row="true"
                  data-widget-hidden={isHidden ? "true" : "false"}
                  data-drag-target={isDropTarget ? "true" : undefined}
                  data-dragging={draggingId === widget.id ? "true" : undefined}
                  onDragOver={handleDragOver(widget.id)}
                  onDragLeave={handleDragLeave(widget.id)}
                  onDrop={handleDrop(widget.id)}
                  onDragEnd={handleDragEnd}
                  className={rowClassName}
                >
                  <ListRow
                    title={(
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{widget.label}</span>
                        {isHidden ? (
                          <span
                            data-widget-hidden-badge="true"
                            className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs font-bold uppercase tracking-[0.12em] text-text-secondary"
                          >
                            Hidden
                          </span>
                        ) : null}
                      </span>
                    )}
                    subtitle={widget.description}
                    leftRailColor="var(--color-accent-sage)"
                    className={isHidden ? "border-dashed border-[var(--color-border)]" : ""}
                    leading={(
                      <span
                        draggable
                        data-widget-drag-handle="true"
                        title="Drag to reorder"
                        aria-hidden="true"
                        onDragStart={handleDragStart(widget.id)}
                        className="grid h-9 w-6 cursor-grab place-items-center text-text-muted active:cursor-grabbing"
                      >
                        ⋮⋮
                      </span>
                    )}
                    trailing={(
                      <div className="flex items-center gap-1">
                        <Toggle
                          checked={!isHidden}
                          onCheckedChange={(checked) => handleToggle(widget.id, checked)}
                          aria-label={`Show ${widget.label}`}
                        />
                        <IconButton
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${widget.label} up`}
                          disabled={index === 0}
                          onClick={() => handleMoveUp(widget.id)}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${widget.label} down`}
                          disabled={index === editingOrdered.length - 1}
                          onClick={() => handleMoveDown(widget.id)}
                        >
                          ↓
                        </IconButton>
                      </div>
                    )}
                  />
                </div>
              );
            })}
          </div>
          {visibleCount === 0 ? (
            <p className="text-xs text-text-muted">All widgets are hidden — turn one on to fill the Home dashboard.</p>
          ) : null}
        </div>
        <div className="mt-4 flex gap-2">
          <SoftButton variant="secondary" onClick={() => setResetOpen(true)} className="flex-1">Reset layout</SoftButton>
          <SoftButton variant="ghost" onClick={() => setHelpOpen(true)} className="flex-1">Help</SoftButton>
        </div>
      </SectionCard>

      <SettingsConfirmDialog
        open={resetOpen}
        title="Reset layout?"
        description="Restore the default order and visibility for all three layout modes."
        confirmLabel="Reset layout"
        busy={false}
        onConfirm={confirmReset}
        onClose={() => setResetOpen(false)}
      >
        <p className="text-sm text-text-secondary">
          Phone, tablet, and desktop will return to their default widget order and visibility.
        </p>
      </SettingsConfirmDialog>

      <Modal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Layout & display help"
        description="Control which widgets appear on your Home dashboard."
        panelClassName="settings-dialog"
        footer={<SoftButton variant="secondary" onClick={() => setHelpOpen(false)} className="flex-1">Got it</SoftButton>}
      >
        <div className="space-y-4 text-sm text-text-secondary">
          <p>Widgets are listed in the order they appear on Home. Toggle a widget off and its row stays in place with a clear Hidden badge; hidden widgets do not appear on the Home dashboard. Use ↑/↓ or the dedicated drag handle to reorder any row, hidden or visible.</p>
          <p><strong className="text-text-primary">Phone / Tablet / Desktop</strong> — Home uses a uniform widget grid. Weather has no special hero tier; it follows the same grid rules as every other widget. When an odd number of visible widgets fills a tablet row, the last visible widget may span that final row. Phone layouts use one column, tablet layouts pair widgets, and desktop layouts fill the available width with uniform cards.</p>
          <p><strong className="text-text-primary">Reset layout</strong> — Restores all three layout modes (phone, tablet, desktop) to their default order and visibility.</p>
        </div>
      </Modal>
    </section>
  );
}
