import * as React from "react";
import { Play, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InfoBubble } from "@/components/InfoBubble";
import { useTimeEntries, useCreateTimeEntry } from "@/hooks/use-time-entries";
import { useClients } from "@/hooks/use-clients";
import { useMe } from "@/hooks/use-me";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@/lib/api";
import {
  centsToCurrency,
  cn,
  formatCentsAsDollars,
  formatDateTime,
  minutesToHours,
  parseDollarsToCents,
} from "@/lib/utils";

type Mode = "duration" | "timer" | "start_end";

type ActiveTimer = {
  clientId: string;
  description: string;
  startedAt: string;
  rateCents: number | null;
};

const TIMER_KEY = "professionalbilling.activeTimer";
const QUICK_PICK_MINUTES = [15, 30, 45, 60];

function readActiveTimer(): ActiveTimer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TIMER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveTimer>;
    if (typeof parsed?.startedAt !== "string") return null;
    return {
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : "",
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      startedAt: parsed.startedAt,
      rateCents:
        typeof parsed.rateCents === "number" ? parsed.rateCents : null,
    };
  } catch {
    return null;
  }
}

function writeActiveTimer(t: ActiveTimer) {
  window.localStorage.setItem(TIMER_KEY, JSON.stringify(t));
}

function clearActiveTimer() {
  window.localStorage.removeItem(TIMER_KEY);
}

function parseDurationMinutes(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 ? n : null;
  }
  const match = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match) return null;
  const h = match[1] ? parseInt(match[1], 10) : 0;
  const m = match[2] ? parseInt(match[2], 10) : 0;
  const total = h * 60 + m;
  return total > 0 ? total : null;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDateTimeToIso(value: string): string {
  return new Date(value).toISOString();
}

function dateAndTimeToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function TimeEntriesPage() {
  const entriesQ = useTimeEntries();
  const clientsQ = useClients();
  const meQ = useMe();
  const createEntry = useCreateTimeEntry();
  const { toast } = useToast();

  const [activeTimer, setActiveTimer] = React.useState<ActiveTimer | null>(
    () => readActiveTimer(),
  );
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("duration");

  const [clientId, setClientId] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [rateDollars, setRateDollars] = React.useState("");
  const [rateUserEdited, setRateUserEdited] = React.useState(false);

  const [date, setDate] = React.useState<string>(todayLocalDate());
  const [startTime, setStartTime] = React.useState<string>("09:00");
  const [durationInput, setDurationInput] = React.useState<string>("60");

  const [startedAtLocal, setStartedAtLocal] = React.useState("");
  const [endedAtLocal, setEndedAtLocal] = React.useState("");

  const [formError, setFormError] = React.useState<string | null>(null);

  const clients = clientsQ.data ?? [];
  const userDefaultRateCents = meQ.data?.user?.default_rate_cents ?? null;

  const clientLookup = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) m.set(c.id, c.name);
    return m;
  }, [clients]);

  const resolveDefaultRateCents = React.useCallback(
    (selectedClientId: string): number | null => {
      const client = clients.find((c) => c.id === selectedClientId);
      return client?.default_rate_cents ?? userDefaultRateCents ?? null;
    },
    [clients, userDefaultRateCents],
  );

  const resetForm = React.useCallback(() => {
    setMode(readActiveTimer() ? "timer" : "duration");
    setClientId("");
    setDescription("");
    setRateDollars("");
    setRateUserEdited(false);
    setDate(todayLocalDate());
    setStartTime("09:00");
    setDurationInput("60");
    setStartedAtLocal("");
    setEndedAtLocal("");
    setFormError(null);
  }, []);

  const prevOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (open && !prevOpenRef.current) {
      resetForm();
      const timer = readActiveTimer();
      if (timer) setMode("timer");
    }
    prevOpenRef.current = open;
  }, [open, resetForm]);

  const resolvedDefaultRateCents = React.useMemo(
    () => resolveDefaultRateCents(clientId),
    [resolveDefaultRateCents, clientId],
  );

  React.useEffect(() => {
    if (!open) return;
    if (rateUserEdited) return;
    setRateDollars(
      resolvedDefaultRateCents == null
        ? ""
        : formatCentsAsDollars(resolvedDefaultRateCents),
    );
  }, [open, rateUserEdited, resolvedDefaultRateCents]);

  const handleClientChange = (nextId: string) => {
    setClientId(nextId);
  };

  const handleRateChange = (value: string) => {
    setRateDollars(value);
    setRateUserEdited(value.trim() !== "");
  };

  const parsedRateCents = React.useMemo<number | null>(() => {
    const trimmed = rateDollars.trim();
    if (!trimmed) return null;
    return parseDollarsToCents(trimmed);
  }, [rateDollars]);

  const rateInvalid = rateDollars.trim() !== "" && parsedRateCents == null;

  const now = useTickingNow(activeTimer != null);

  const submitEntry = async (payload: {
    started_at: string;
    ended_at: string;
    description: string;
    client_id: string;
    rate_cents: number | null;
  }) => {
    const res = await createEntry.mutateAsync({
      description: payload.description,
      client_id: payload.client_id || undefined,
      started_at: payload.started_at,
      ended_at: payload.ended_at,
      hourly_rate_cents:
        payload.rate_cents != null ? payload.rate_cents : undefined,
    });
    if (res.warnings && res.warnings.length > 0) {
      for (const w of res.warnings) {
        toast({ variant: "warning", title: "Heads up", description: w });
      }
    } else {
      toast({ title: "Time entry logged" });
    }
  };

  const handleDurationSubmit = async () => {
    setFormError(null);
    if (!description.trim()) {
      setFormError("Description is required");
      return;
    }
    if (!date || !startTime) {
      setFormError("Date and start time are required");
      return;
    }
    const minutes = parseDurationMinutes(durationInput);
    if (!minutes) {
      setFormError("Enter a duration like 90 or 1h 30m");
      return;
    }
    if (rateInvalid) {
      setFormError("Enter the rate in dollars (e.g. 200.00)");
      return;
    }
    const startIso = dateAndTimeToIso(date, startTime);
    const endIso = new Date(
      new Date(startIso).getTime() + minutes * 60_000,
    ).toISOString();
    try {
      await submitEntry({
        started_at: startIso,
        ended_at: endIso,
        description: description.trim(),
        client_id: clientId,
        rate_cents: parsedRateCents,
      });
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not log entry",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleStartEndSubmit = async () => {
    setFormError(null);
    if (!description.trim()) {
      setFormError("Description is required");
      return;
    }
    if (!startedAtLocal || !endedAtLocal) {
      setFormError("Start and end are required");
      return;
    }
    const startIso = localDateTimeToIso(startedAtLocal);
    const endIso = localDateTimeToIso(endedAtLocal);
    if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
      setFormError("End must be after start");
      return;
    }
    if (rateInvalid) {
      setFormError("Enter the rate in dollars (e.g. 200.00)");
      return;
    }
    try {
      await submitEntry({
        started_at: startIso,
        ended_at: endIso,
        description: description.trim(),
        client_id: clientId,
        rate_cents: parsedRateCents,
      });
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not log entry",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  const handleStartTimer = () => {
    setFormError(null);
    if (!clientId) {
      setFormError("Select a client before starting the timer");
      return;
    }
    if (rateInvalid) {
      setFormError("Enter the rate in dollars (e.g. 200.00)");
      return;
    }
    const next: ActiveTimer = {
      clientId,
      description: description.trim(),
      startedAt: new Date().toISOString(),
      rateCents: parsedRateCents,
    };
    writeActiveTimer(next);
    setActiveTimer(next);
  };

  const handleTimerDescriptionChange = (value: string) => {
    setDescription(value);
    if (activeTimer) {
      const next = { ...activeTimer, description: value };
      writeActiveTimer(next);
      setActiveTimer(next);
    }
  };

  const handleStopTimer = async () => {
    if (!activeTimer) return;
    const endIso = new Date().toISOString();
    try {
      await submitEntry({
        started_at: activeTimer.startedAt,
        ended_at: endIso,
        description: activeTimer.description.trim() || "Timed entry",
        client_id: activeTimer.clientId,
        rate_cents: activeTimer.rateCents,
      });
      clearActiveTimer();
      setActiveTimer(null);
      setOpen(false);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save timer",
        description: err instanceof ApiError ? err.message : "Unexpected error",
      });
    }
  };

  React.useEffect(() => {
    if (!open || mode !== "timer") return;
    const timer = readActiveTimer();
    if (!timer) return;
    setClientId(timer.clientId);
    setDescription(timer.description);
    setRateDollars(
      timer.rateCents != null ? formatCentsAsDollars(timer.rateCents) : "",
    );
    setRateUserEdited(true);
  }, [open, mode]);

  const submitLabel = createEntry.isPending ? "Saving…" : "Save entry";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Time</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Log billable hours and assign them to clients.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> Log time
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Log time</DialogTitle>
              <DialogDescription>
                Record work you&apos;ve done. Unassigned entries won&apos;t be
                invoiced automatically.
              </DialogDescription>
            </DialogHeader>

            <ModeTabs
              value={mode}
              onChange={(next) => {
                setMode(next);
                setFormError(null);
              }}
              timerRunning={activeTimer != null}
            />

            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="client_id">Client</Label>
                  <InfoBubble entryKey="time-entry-client-assignment" />
                </div>
                <select
                  id="client_id"
                  className="flex h-9 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  value={clientId}
                  onChange={(e) => handleClientChange(e.target.value)}
                  disabled={mode === "timer" && activeTimer != null}
                >
                  <option value="">— Unassigned —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={2}
                  value={description}
                  onChange={(e) =>
                    mode === "timer" && activeTimer
                      ? handleTimerDescriptionChange(e.target.value)
                      : setDescription(e.target.value)
                  }
                  autoFocus
                />
              </div>

              {mode === "duration" ? (
                <DurationFields
                  date={date}
                  setDate={setDate}
                  startTime={startTime}
                  setStartTime={setStartTime}
                  durationInput={durationInput}
                  setDurationInput={setDurationInput}
                />
              ) : null}

              {mode === "start_end" ? (
                <StartEndFields
                  startedAtLocal={startedAtLocal}
                  setStartedAtLocal={setStartedAtLocal}
                  endedAtLocal={endedAtLocal}
                  setEndedAtLocal={setEndedAtLocal}
                />
              ) : null}

              {mode === "timer" && activeTimer ? (
                <TimerRunning
                  startedAt={activeTimer.startedAt}
                  now={now}
                />
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="rate_dollars">Hourly rate</Label>
                <Input
                  id="rate_dollars"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={
                    resolvedDefaultRateCents != null
                      ? formatCentsAsDollars(resolvedDefaultRateCents)
                      : "200.00"
                  }
                  value={rateDollars}
                  onChange={(e) => handleRateChange(e.target.value)}
                  disabled={mode === "timer" && activeTimer != null}
                />
                {rateInvalid ? (
                  <p className="text-xs text-[var(--color-destructive)]">
                    Enter a dollar amount like 200.00
                  </p>
                ) : parsedRateCents === 0 ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Logging $0 — is this pro bono?
                  </p>
                ) : null}
              </div>

              {formError ? (
                <p className="text-sm text-[var(--color-destructive)]">
                  {formError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              {mode === "timer" ? (
                activeTimer ? (
                  <Button
                    type="button"
                    onClick={handleStopTimer}
                    disabled={createEntry.isPending}
                  >
                    <Square className="h-4 w-4" />
                    {createEntry.isPending ? "Saving…" : "Stop & save"}
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="button" onClick={handleStartTimer}>
                      <Play className="h-4 w-4" /> Start timer
                    </Button>
                  </>
                )
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={
                      mode === "duration"
                        ? handleDurationSubmit
                        : handleStartEndSubmit
                    }
                    disabled={createEntry.isPending}
                  >
                    {submitLabel}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {activeTimer ? (
        <ActiveTimerBanner
          activeTimer={activeTimer}
          now={now}
          clientName={
            activeTimer.clientId
              ? clientLookup.get(activeTimer.clientId) ?? "Unknown client"
              : "Unassigned"
          }
          onOpen={() => {
            setOpen(true);
            setMode("timer");
          }}
        />
      ) : null}

      {entriesQ.isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : entriesQ.data && entriesQ.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--color-border)]">
              {entriesQ.data.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-4 px-6 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{e.description}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {formatDateTime(e.started_at)} →{" "}
                      {formatDateTime(e.ended_at)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium">
                      {minutesToHours(e.duration_minutes)}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {e.client_id
                        ? clientLookup.get(e.client_id) ?? "Unknown client"
                        : "Unassigned"}
                      {e.hourly_rate_cents != null ? (
                        <>
                          {" · "}
                          {centsToCurrency(e.hourly_rate_cents)}/hr
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-10 text-center">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No time entries yet. Log your first one.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function useTickingNow(enabled: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return now;
}

type ModeTabsProps = {
  value: Mode;
  onChange: (next: Mode) => void;
  timerRunning: boolean;
};

function ModeTabs({ value, onChange, timerRunning }: ModeTabsProps) {
  const options: { key: Mode; label: string }[] = [
    { key: "duration", label: "Duration" },
    { key: "timer", label: timerRunning ? "Timer •" : "Timer" },
    { key: "start_end", label: "Start / End" },
  ];
  return (
    <div
      role="tablist"
      className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-0.5 text-sm"
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="tab"
          aria-selected={value === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn(
            "rounded px-3 py-1.5 text-xs font-medium transition-colors",
            value === opt.key
              ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type DurationFieldsProps = {
  date: string;
  setDate: (v: string) => void;
  startTime: string;
  setStartTime: (v: string) => void;
  durationInput: string;
  setDurationInput: (v: string) => void;
};

function DurationFields({
  date,
  setDate,
  startTime,
  setStartTime,
  durationInput,
  setDurationInput,
}: DurationFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="duration_date">Date</Label>
          <Input
            id="duration_date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="duration_start">Start time</Label>
          <Input
            id="duration_start"
            type="time"
            step={900}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="duration_minutes">Duration</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_PICK_MINUTES.map((m) => {
            const active = parseDurationMinutes(durationInput) === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setDurationInput(String(m))}
                className={cn(
                  "rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]"
                    : "hover:bg-[var(--color-accent)]",
                )}
              >
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            );
          })}
          <Input
            id="duration_minutes"
            inputMode="text"
            placeholder="e.g. 90 or 1h 30m"
            value={durationInput}
            onChange={(e) => setDurationInput(e.target.value)}
            className="max-w-[12rem]"
          />
        </div>
      </div>
    </>
  );
}

type StartEndFieldsProps = {
  startedAtLocal: string;
  setStartedAtLocal: (v: string) => void;
  endedAtLocal: string;
  setEndedAtLocal: (v: string) => void;
};

function StartEndFields({
  startedAtLocal,
  setStartedAtLocal,
  endedAtLocal,
  setEndedAtLocal,
}: StartEndFieldsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="started_at">Start</Label>
        <Input
          id="started_at"
          type="datetime-local"
          step={900}
          value={startedAtLocal}
          onChange={(e) => setStartedAtLocal(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ended_at">End</Label>
        <Input
          id="ended_at"
          type="datetime-local"
          step={900}
          value={endedAtLocal}
          onChange={(e) => setEndedAtLocal(e.target.value)}
        />
      </div>
    </div>
  );
}

function TimerRunning({
  startedAt,
  now,
}: {
  startedAt: string;
  now: number;
}) {
  const elapsed = now - new Date(startedAt).getTime();
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Running
      </div>
      <div className="font-mono text-2xl tabular-nums">
        {formatElapsed(elapsed)}
      </div>
      <div className="text-xs text-[var(--color-muted-foreground)]">
        Started {formatDateTime(startedAt)}
      </div>
    </div>
  );
}

type ActiveTimerBannerProps = {
  activeTimer: ActiveTimer;
  now: number;
  clientName: string;
  onOpen: () => void;
};

function ActiveTimerBanner({
  activeTimer,
  now,
  clientName,
  onOpen,
}: ActiveTimerBannerProps) {
  const elapsed = now - new Date(activeTimer.startedAt).getTime();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-accent)]"
    >
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
          Timer running · {clientName}
        </div>
        <div className="truncate text-sm">
          {activeTimer.description || "Timed entry"}
        </div>
      </div>
      <div className="font-mono text-lg tabular-nums">
        {formatElapsed(elapsed)}
      </div>
    </button>
  );
}
