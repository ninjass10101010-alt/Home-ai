"use client";

import { useState, useId, type CSSProperties } from "react";
import Surface from "@/components/ui/Surface";
import SoftButton from "@/components/ui/SoftButton";
import IconButton from "@/components/ui/IconButton";
import Toggle from "@/components/ui/Toggle";
import SegmentedControl from "@/components/ui/SegmentedControl";
import Chip from "@/components/ui/Chip";
import ListRow from "@/components/ui/ListRow";
import SwipeableRow from "@/components/ui/SwipeableRow";
import TextField from "@/components/ui/TextField";
import Stepper from "@/components/ui/Stepper";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import ProgressRing from "@/components/ui/ProgressRing";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";
import PullToRefresh from "@/components/ui/PullToRefresh";
import Toast from "@/components/ui/Toast";
import PageHeader from "@/components/patterns/PageHeader";
import SectionCard from "@/components/patterns/SectionCard";
import StatTile from "@/components/patterns/StatTile";
import DayStrip from "@/components/patterns/DayStrip";
import FormField from "@/components/patterns/FormField";
import MoreMenuItem from "@/components/patterns/MoreMenuItem";
import { warmGlassAccentOptions } from "@/lib/design-tokens";

const darkModeStyles = {
  "--color-surface-0": "#171b26",
  "--color-surface-1": "#202633",
  "--color-surface-2": "#263041",
  "--color-surface-3": "#303b50",
  "--color-surface-4": "#3b4860",
  "--color-surface-5": "#45526c",
  "--color-surface-6": "#52607a",
  "--color-surface-7": "#61708a",
  "--color-text-primary": "#f8fbff",
  "--color-text-secondary": "#b8c2d6",
  "--color-text-muted": "#8d98ad",
  "--color-text-dim": "#69748a",
  "--color-accent-selected": "#7dd3fc",
  "--color-accent-button": "#38bdf8",
  "--color-accent-glow": "rgba(125,211,252,0.32)",
  background: "linear-gradient(180deg, rgba(38,48,65,0.78), rgba(23,27,38,0.78))",
  border: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "0 16px 48px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.12)",
  color: "#f8fbff",
} as CSSProperties;

const lightModeStyles = {
  "--color-surface-0": "#ffffff",
  "--color-surface-1": "#f8f9fb",
  "--color-surface-2": "#f0f2f7",
  "--color-surface-3": "#e7ebf3",
  "--color-surface-4": "#dde3ed",
  "--color-surface-5": "#d3dae7",
  "--color-surface-6": "#c9d1e0",
  "--color-surface-7": "#bfc6d8",
  "--color-text-primary": "#1a1a1a",
  "--color-text-secondary": "#5a5a5a",
  "--color-text-muted": "#8a8a8a",
  "--color-text-dim": "#ababab",
  "--color-accent-selected": "#2563eb",
  "--color-accent-button": "#1d4ed8",
  "--color-accent-glow": "rgba(37,99,235,0.25)",
} as CSSProperties;

export default function DesignSystemPage() {
  const inputId = useId();
  const [segment, setSegment] = useState("home");
  const [toggle, setToggle] = useState(true);
  const [step, setStep] = useState(3);
  const [modalOpen, setModalOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);

  if (process.env.NODE_ENV === "production") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-0)] p-6 text-center">
        <div className="max-w-md rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/80 p-8 backdrop-blur-xl">
          <h1 className="text-xl font-bold text-text-primary">Design system preview</h1>
          <p className="mt-3 text-sm text-text-secondary">This route is only available in development.</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--color-canvas)] px-4 py-8 pb-24">
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeader
          title="Warm Glass System Review"
          subtitle="Primitives and patterns in dark and light review modes"
        />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex-1 space-y-6">
            <SectionCard title="Controls" description="Core tactile and glass controls">
              <div className="grid gap-4 sm:grid-cols-2">
                <SoftButton variant="primary">Primary</SoftButton>
                <SoftButton variant="secondary">Secondary</SoftButton>
                <IconButton aria-label="Add item"><span>＋</span></IconButton>
                <Toggle checked={toggle} onCheckedChange={setToggle} label="Enable warm glass" />
              </div>
            </SectionCard>

            <SectionCard title="Inputs" description="Text, segmented, stepper, and form fields">
              <div className="space-y-4">
                <SegmentedControl
                  aria-label="Review section"
                  options={[
                    { id: "home", label: "Home" },
                    { id: "tasks", label: "Tasks" },
                    { id: "meals", label: "Meals" },
                  ]}
                  value={segment}
                  onChange={(value) => setSegment(value as string)}
                />
                <TextField id={inputId} label="Task name" placeholder="Pack lunch" helperText="Neumorphic inset field" />
                <FormField label="Amount" helperText="Wrapped label pattern">
                  <Stepper value={step} onChange={setStep} min={1} max={10} />
                </FormField>
              </div>
            </SectionCard>

            <SectionCard title="Lists" description="Rows, chips, and swipe affordances">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Chip>Today</Chip>
                  <Chip tone="success">Done</Chip>
                  <Chip tone="warning">Later</Chip>
                </div>
                <ListRow title="Pack backpack" subtitle="Due today · 10 pts" leading={<span>🎒</span>} leftRailColor="var(--color-accent-sage)" />
                <SwipeableRow
                  leftAction={<span className="pl-4 text-sm font-semibold">✓</span>}
                  rightAction={<span className="pr-4 text-sm font-semibold">Snooze</span>}
                  className="rounded-2xl"
                >
                  <ListRow title="Wipe counters" subtitle="Swipe right to complete" leading={<span>✨</span>} />
                </SwipeableRow>
              </div>
            </SectionCard>

            <SectionCard title="Feedback" description="Empty, error, progress, skeleton, modal, toast">
              <div className="grid gap-3 sm:grid-cols-2">
                <EmptyState title="No chores" description="Everything is caught up" actionLabel="Add chore" onAction={() => undefined} />
                <ErrorState title="Could not sync" description="Try again when the connection is back" retryLabel="Retry" onRetry={() => undefined} />
                <ProgressRing value={72} max={100} label="Routine progress" detail="18 of 25 done" />
                <Skeleton className="h-24 rounded-2xl" />
              </div>
              <div className="mt-4 flex gap-3">
                <SoftButton variant="secondary" onClick={() => setModalOpen(true)}>Open modal</SoftButton>
                <SoftButton variant="primary" onClick={() => setToastOpen(true)}>Show toast</SoftButton>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6 lg:w-96">
            <SectionCard title="Theme preview" description="Manual surface tokens for review">
              <div className="grid gap-3">
                <Surface variant="glass" className="backdrop-blur-2xl" style={darkModeStyles}>Dark glass — visible</Surface>
                <Surface variant="glass" style={lightModeStyles}>Light glass</Surface>
                <Surface variant="neu">Neumorphic raised</Surface>
                <Surface variant="neu-pressed">Neumorphic pressed</Surface>
              </div>
            </SectionCard>

            <SectionCard title="Patterns" description="Reusable page and navigation patterns">
              <div className="space-y-4">
                <StatTile label="Points" value="240" detail="+35 this week" icon="⭐" tone="success" />
                <DayStrip
                  value="mon"
                  onChange={() => undefined}
                  days={[
                    { id: "mon", label: "Mon" },
                    { id: "tue", label: "Tue" },
                    { id: "wed", label: "Wed" },
                    { id: "thu", label: "Thu" },
                    { id: "fri", label: "Fri" },
                    { id: "sat", label: "Sat" },
                    { id: "sun", label: "Sun" },
                  ]}
                />
                <MoreMenuItem icon="🛒" title="Grocery" description="Shopping list" href="/grocery" />
                <MoreMenuItem icon="🛡️" title="Emergency" description="Contacts" href="/emergency" />
              </div>
            </SectionCard>

            <SectionCard title="Accents" description="Warm Glass v2 accent palette">
              <div className="grid grid-cols-2 gap-3">
                {warmGlassAccentOptions.map((accent) => (
                  <div key={accent.id} className="rounded-2xl border border-white/10 bg-[var(--color-surface-2)] p-3">
                    <div className="mb-2 h-10 rounded-xl" style={{ background: `linear-gradient(135deg, ${accent.hex}, ${accent.glow})` }} />
                    <p className="text-sm font-semibold text-text-primary">{accent.label}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      <Modal open={modalOpen} title="Modal preview" onClose={() => setModalOpen(false)}>
        <p className="text-sm text-text-secondary">Bottom-sheet modal primitive with glass surface.</p>
        <div className="mt-5 flex justify-end gap-3">
          <SoftButton variant="secondary" onClick={() => setModalOpen(false)}>Close</SoftButton>
          <SoftButton variant="primary" onClick={() => setModalOpen(false)}>Done</SoftButton>
        </div>
      </Modal>

      <Toast open={toastOpen} tone="success">
        {toastOpen ? "Toast preview" : null}
      </Toast>
    </main>
  );
}
