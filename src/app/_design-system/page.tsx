"use client";

import { useState, type CSSProperties } from "react";
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
  "--color-surface-0": "#0f1117",
  "--color-surface-1": "#181c24",
  "--color-surface-2": "#1e2330",
  "--color-surface-3": "#252c3a",
  "--color-surface-4": "#2d3548",
  "--color-surface-5": "#323b4d",
  "--color-surface-6": "#3a4456",
  "--color-surface-7": "#434e60",
  "--color-text-primary": "#f0f4ff",
  "--color-text-secondary": "#8892aa",
  "--color-text-muted": "#4e5a72",
  "--color-text-dim": "#363e50",
  "--color-accent-selected": "#3b82f6",
  "--color-accent-button": "#2563eb",
  "--color-accent-glow": "rgba(59,130,246,0.25)",
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
    <div className="min-h-screen bg-[var(--color-surface-0)] pb-20">
      <Toast open={toastOpen} tone="success">Warm Glass primitive rendered successfully.</Toast>
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Primitive modal"
        description="Bottom-sheet modal primitive with safe-area padding and glass surface."
        footer={
          <SoftButton onClick={() => setModalOpen(false)} className="flex-1">
            Close
          </SoftButton>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">This modal uses the new Modal primitive and can contain any children.</p>
      </Modal>

      <PageHeader title="Warm Glass v2" subtitle="Primitives + patterns in dark and light themes" action={<SoftButton onClick={() => setToastOpen(true)}>Show toast</SoftButton>} />

      <div className="px-4 space-y-10">
        <SectionCard title="Accent palette" description="Ten accent colors for family warmth, trust, urgency, and calm.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {warmGlassAccentOptions.map((accent) => (
              <Surface key={accent.id} variant="glass-subtle" radius="xl" padding="sm">
                <div className="h-12 rounded-2xl" style={{ background: accent.hex }} />
                <div className="mt-2 text-sm font-semibold text-text-primary">{accent.label}</div>
                <div className="mt-0.5 text-xs text-text-muted">{accent.description}</div>
              </Surface>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Primitives" description="All canonical UI primitives.">
          <div className="grid gap-4 lg:grid-cols-2">
            <Surface variant="warm" radius="xl" padding="lg">
              <h3 className="mb-4 text-sm font-bold text-text-primary">Buttons</h3>
              <div className="flex flex-wrap gap-2">
                <SoftButton onClick={() => setToastOpen(true)}>Primary</SoftButton>
                <SoftButton variant="secondary">Secondary</SoftButton>
                <SoftButton variant="ghost">Ghost</SoftButton>
                <SoftButton variant="danger">Danger</SoftButton>
                <SoftButton variant="success">Success</SoftButton>
              </div>
              <div className="mt-4 flex gap-2">
                <IconButton aria-label="Settings"><span>⚙️</span></IconButton>
                <IconButton variant="accent" aria-label="Add"><span>＋</span></IconButton>
                <IconButton variant="danger" aria-label="Delete"><span>×</span></IconButton>
              </div>
            </Surface>

            <Surface variant="warm" radius="xl" padding="lg">
              <h3 className="mb-4 text-sm font-bold text-text-primary">Controls</h3>
              <div className="space-y-4">
                <Toggle checked={toggle} onCheckedChange={setToggle} label="Enable warm glass" description="Glass cards plus neomorphic controls" />
                <SegmentedControl
                  aria-label="Design system section"
                  value={segment}
                  onChange={setSegment}
                  options={[
                    { id: "home", label: "Home" },
                    { id: "tasks", label: "Tasks" },
                    { id: "meals", label: "Meals" },
                    { id: "settings", label: "Settings" },
                  ]}
                />
                <Stepper value={step} onChange={setStep} label="Quantity" />
                <TextField label="Family name" helperText="Used for headings and family row." placeholder="Garcia" />
              </div>
            </Surface>

            <Surface variant="warm" radius="xl" padding="lg">
              <h3 className="mb-4 text-sm font-bold text-text-primary">Chips + rows</h3>
              <div className="mb-4 flex flex-wrap gap-2">
                <Chip tone="neutral">Neutral</Chip>
                <Chip tone="accent" selected>Accent</Chip>
                <Chip tone="success">Success</Chip>
                <Chip tone="warning">Warning</Chip>
                <Chip tone="danger">Danger</Chip>
              </div>
              <div className="space-y-3">
                <ListRow title="Take out trash" subtitle="Caspian · Today · 10 pts" leftRailColor="#fb923c" trailing={<Chip size="sm" tone="success">+10</Chip>} />
                <SwipeableRow leftAction={<span className="text-sm font-bold">✓</span>} rightAction={<span className="text-sm font-bold">×</span>}>
                  <ListRow title="Swipe me" subtitle="Right completes, left dismisses" leftRailColor="#84cc16" />
                </SwipeableRow>
              </div>
            </Surface>

            <Surface variant="warm" radius="xl" padding="lg">
              <h3 className="mb-4 text-sm font-bold text-text-primary">States</h3>
              <div className="grid gap-3">
                <EmptyState title="All caught up" description="No tasks are pending for today." icon="✅" />
                <ErrorState title="Sync failed" description="Consuela could not reach the meal sync service." retryLabel="Retry" />
                <ProgressRing value={7} max={10} label="Meals planned" detail="7 of 10 slots filled" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton variant="card" />
                  <Skeleton variant="title" />
                  <Skeleton variant="text" />
                  <Skeleton variant="avatar" />
                </div>
              </div>
            </Surface>
          </div>
        </SectionCard>

        <SectionCard title="Patterns" description="Composable page patterns used by Home, Tasks, Meals, and Settings.">
          <div className="space-y-5">
            <PageHeader title="Family Dashboard" subtitle="Today at a glance" action={<SoftButton size="sm">Ask</SoftButton>} />
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Meals planned" value="7" detail="This week" icon="🍽️" tone="success" />
              <StatTile label="Pending tasks" value="3" detail="Today" icon="✅" tone="warning" />
              <StatTile label="Events" value="2" detail="Urgent" icon="📅" tone="danger" />
            </div>
            <DayStrip
              value="today"
              onChange={(dayId) => console.log("DayStrip demo:", dayId)}
              days={[
                { id: "mon", label: "Mon", detail: "12", active: false },
                { id: "tue", label: "Tue", detail: "13", active: true },
                { id: "wed", label: "Wed", detail: "14", active: false },
                { id: "thu", label: "Thu", detail: "15", active: false },
                { id: "fri", label: "Fri", detail: "16", active: false },
                { id: "sat", label: "Sat", detail: "17", active: false },
                { id: "sun", label: "Sun", detail: "18", active: false },
              ]}
            />
            <FormField label="Task title" helperText="Use a short action phrase.">
              <input className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted" placeholder="Load dishwasher" />
            </FormField>
            <div className="grid gap-3 sm:grid-cols-2">
              <MoreMenuItem icon="📅" title="Calendar" description="Family routines and events" href="/calendar" />
              <MoreMenuItem icon="🛒" title="Grocery" description="Smart list and sync status" href="/meals?tab=grocery" badge="Synced" />
              <MoreMenuItem icon="🛡️" title="Emergency" description="Non-critical reference page" href="/emergency" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Theme matrix" description="Dark and light previews using inline token overrides.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 p-5" style={darkModeStyles}>
              <h3 className="mb-4 text-sm font-bold text-text-primary">Dark</h3>
              <Surface variant="warm" radius="xl" padding="lg">
                <p className="text-sm text-text-secondary">Glass + neumorphism on dark canvas.</p>
                <div className="mt-4 flex gap-2">
                  <SoftButton>Primary</SoftButton>
                  <SoftButton variant="secondary">Secondary</SoftButton>
                </div>
              </Surface>
            </div>
            <div className="rounded-3xl border border-black/5 p-5" style={lightModeStyles}>
              <h3 className="mb-4 text-sm font-bold text-text-primary">Light</h3>
              <Surface variant="warm" radius="xl" padding="lg">
                <p className="text-sm text-text-secondary">Glass + neumorphism on light canvas.</p>
                <div className="mt-4 flex gap-2">
                  <SoftButton>Primary</SoftButton>
                  <SoftButton variant="secondary">Secondary</SoftButton>
                </div>
              </Surface>
            </div>
          </div>
        </SectionCard>

        <PullToRefresh onRefresh={() => setToastOpen(true)}>
          <Surface variant="warm" radius="xl" padding="lg">
            <p className="text-sm text-text-secondary">Pull down on this block to trigger a refresh toast.</p>
          </Surface>
        </PullToRefresh>
      </div>
    </div>
  );
}
