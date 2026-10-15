"use client";
import Image from "next/image";
import IncomingCalls from "./incoming-calls";
import PipelineBoard from "./pipeline-board";
import RowActions from "./row-actions";
import LeadSummary from "./lead-summary";
import {
  viewState,
  viewFromUrl,
  stateFromUrl,
  stateToUrl,
  type ViewState,
} from "@/lib/workspace-view";
import { CallingSession } from "./sales-kpis";
import CallScript from "./call-script";
import { ActiveUsage } from "./productivity";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  Columns3,
  Users,
  ChartNoAxesCombined,
  Phone,
  Settings,
  ArrowUpRight,
  Plus,
  Search,
  RefreshCw,
  X,
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  LogOut,
  ArrowRight,
  Download,
  Upload,
  Clock3,
  SlidersHorizontal,
} from "lucide-react";
import {
  STAGES,
  OUTCOMES,
  type Bootstrap,
  type Lead,
  type Member,
  type Activity,
  type LeadInput,
} from "@/lib/types";
import AdvancedAnalytics from "./advanced-analytics";
import ThemeSwitcher from "./theme-switcher";
import Reconciliation from "./reconciliation";
import LeadConversation from "./lead-conversation";
import QuoDashboard from "./quo-dashboard";
import { WORK_STATUSES, ZONES, callingInfo } from "@/lib/workflow";
type View = "day" | "pipeline" | "leads" | "analytics" | "phone" | "settings";
type Group = { label: string; count: number };
type Report = {
  total: number;
  open: number;
  open_value: number;
  won: number;
  won_value: number;
  overdue: number;
  unscheduled: number;
  calls: number;
  connected: number;
  recorded_wins: number;
  recorded_revenue: number;
  stages: Group[];
  sources: Group[];
  outcomes: Group[];
  agents: Group[];
  trend: Group[];
  scores: Group[];
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
const nav: [View, string, typeof Phone][] = [
  ["day", "My day", LayoutDashboard],
  ["pipeline", "Pipeline", Columns3],
  ["leads", "All leads", Users],
  ["analytics", "Analytics", ChartNoAxesCombined],
  ["phone", "Quo Phone", Phone],
  ["settings", "Settings", Settings],
];
const emptyLead = (owner: string): LeadInput => ({
  company: "",
  contact: "",
  job_title: "",
  email: "",
  phone: "",
  country: "",
  industry: "",
  source: "",
  score: null,
  stage: "New",
  status: "Active",
  value: 0,
  priority: "Medium",
  notes: "",
  owner_email: owner,
  next_action: "",
  next_follow_up: null,
  loss_reason: "",
  time_zone: "",
  work_status: "None",
});
async function api<T>(
  path: string,
  payload?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method: payload === undefined ? "GET" : "POST",
    headers:
      payload === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
    signal,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function Metrics({ items }: { items: [string, string | number, string][] }) {
  return (
    <div className="metrics">
      {items.map(([title, value, hint]) => (
        <div className="metric" key={title}>
          <span className="eyebrow">{title}</span>
          <strong>{value}</strong>
          <span className="muted">{hint}</span>
        </div>
      ))}
    </div>
  );
}
function Bars({
  title,
  subtitle,
  rows,
  onSelect,
}: {
  title: string;
  subtitle?: string;
  rows: Group[];
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel chart">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <ChartNoAxesCombined size={18} className="muted" />
      </div>
      <div className="bars">
        {rows.length ? (
          rows.map((r) => (
            <button
              key={r.label}
              className="bar-row"
              disabled={!onSelect}
              onClick={() => onSelect?.(r.label)}
              aria-label={`${r.label}: ${r.count}`}
            >
              <span>
                {r.label}
                <b>{r.count}</b>
              </span>
              <i>
                <em style={{ width: `${(100 * r.count) / max}%` }} />
              </i>
            </button>
          ))
        ) : (
          <div className="empty">No data for this period.</div>
        )}
      </div>
    </section>
  );
}
function Badge({ stage }: { stage: string }) {
  return (
    <span
      data-stage={stage}
      className={
        "badge " + (stage === "Won" ? "green" : stage === "Lost" ? "red" : "")
      }
    >
      {stage}
    </span>
  );
}
function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={"field " + (full ? "full" : "")}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export default function Workspace() {
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const searchField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable;
      if (document.querySelector("dialog[open]")) return;
      if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") ||
        (!typing && e.key === "/")
      ) {
        if (searchField.current) {
          e.preventDefault();
          searchField.current.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [accessError, setAccessError] = useState(""),
    [view, setView] = useState<View>("day"),
    [leads, setLeads] = useState<Lead[]>([]),
    [total, setTotal] = useState(0),
    [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("all"),
    [due, setDue] = useState("due"),
    [stage, setStage] = useState(""),
    [page, setPage] = useState(0),
    [reportFrom, setReportFrom] = useState(""),
    [reportTo, setReportTo] = useState("");
  const [ownerFilter, setOwnerFilter] = useState(""),
    [zoneFilter, setZoneFilter] = useState(""),
    [workFilter, setWorkFilter] = useState(""),
    [exactDate, setExactDate] = useState(""),
    [dateField, setDateField] = useState("created"),
    [archived, setArchived] = useState(false);
  const [checked, setChecked] = useState<string[]>([]),
    [bulkStage, setBulkStage] = useState(""),
    [bulkWork, setBulkWork] = useState(""),
    [bulkLoss, setBulkLoss] = useState(""),
    [pendingIds, setPendingIds] = useState<string[]>([]),
    [hoverLane, setHoverLane] = useState("");
  const pending = useRef(new Set<string>()),
    currentLeads = useRef<Lead[]>([]),
    listAbort = useRef<AbortController | null>(null),
    listCache = useRef(
      new Map<string, { at: number; leads: Lead[]; total: number }>(),
    ),
    reportAt = useRef(0),
    reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    reportSequence = useRef(0);
  currentLeads.current = leads;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () => () => {
      listAbort.current?.abort();
      if (reportTimer.current) clearTimeout(reportTimer.current);
    },
    [],
  );
  const [selected, setSelected] = useState<Lead | null>(null),
    [draft, setDraft] = useState<LeadInput | null>(null),
    [drawerTab, setDrawerTab] = useState<"details" | "activity">("details"),
    [drawerError, setDrawerError] = useState(""),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [duplicateReason, setDuplicateReason] = useState(""),
    [history, setHistory] = useState<Activity[]>([]),
    [historyError, setHistoryError] = useState("");
  const [activity, setActivity] = useState({
    type: "Call",
    outcome: "",
    details: "",
    next_action: "",
    next_follow_up: "",
    complete: false,
  });
  const [skips, setSkips] = useState<string[]>([]),
    [phoneId, setPhoneId] = useState("");
  const [teamDraft, setTeamDraft] = useState<Member>({
      email: "",
      display_name: "",
      role: "Agent",
      active: true,
      aliases: [],
    }),
    [teamBusy, setTeamBusy] = useState(false);
  const [csv, setCsv] = useState(""),
    [source, setSource] = useState("original-sheet"),
    [fallback, setFallback] = useState(""),
    [dateFormat, setDateFormat] = useState<"ISO" | "MDY" | "DMY">("ISO"),
    [importPreview, setImportPreview] = useState<{
      total: number;
      errors: string[];
      warnings: string[];
      rows: Record<string, unknown>[];
    } | null>(null),
    [importBusy, setImportBusy] = useState(false);
  const [contactDirty, setContactDirty] = useState(false),
    [contactBusy, setContactBusy] = useState(false);
  const [composerMode, setComposerMode] = useState<"note" | "activity" | "sms">(
    "note",
  );
  const [phoneTab, setPhoneTab] = useState("Queue");
  const [settingsTab, setSettingsTab] = useState("Team");
  const [chatDirty, setChatDirty] = useState(false),
    [chatBusy, setChatBusy] = useState(false);
  const callOpenGuard = useRef(false);
  callOpenGuard.current = saving || chatBusy || contactBusy;
  const drawer = useRef<HTMLDialogElement>(null),
    inputPhone = useRef<HTMLInputElement>(null),
    loadToken = useRef(0),
    historyToken = useRef(0);
  const [navReady, setNavReady] = useState(false);
  const viewMemory = useRef<Record<string, ViewState>>({});
  const navigationUrl = useRef("");
  const restoreSequence = useRef(0);
  const scrollToRestore = useRef<number | null>(null);
  const [columns, setColumns] = useState({
    value: false,
    priority: true,
    timezone: false,
  });
  const captureView = (): ViewState =>
    viewState({
      search,
      scope,
      due,
      stage,
      page,
      owner: ownerFilter,
      zone: zoneFilter,
      work: workFilter,
      date: exactDate,
      dateField,
      archived,
      density,
    });
  function applyView(v: View, state: ViewState) {
    scrollToRestore.current = state.scroll;
    setView(v);
    setSearch(state.search);
    setQuery(state.search);
    setScope(state.scope);
    setDue(state.due);
    setStage(state.stage);
    setPage(state.page);
    setOwnerFilter(state.owner);
    setZoneFilter(state.zone);
    setWorkFilter(state.work);
    setExactDate(state.date);
    setDateField(state.dateField);
    setArchived(state.archived);
    setDensity(state.density);
    setChecked([]);
  }
  const navGuard = useRef({
    dirty: false,
    saving: false,
    chatBusy: false,
    chatDirty: false,
  });
  navGuard.current = {
    dirty: dirty || contactDirty,
    saving: saving || contactBusy,
    chatBusy,
    chatDirty,
  };
  useEffect(() => {
    if (!boot) return;
    if (boot.member.role !== "Admin") setSettingsTab("Preferences");
    const key = "frontline-views:" + boot.member.email;
    let saved: any = {};
    try {
      saved = JSON.parse(localStorage.getItem(key) || "{}");
      if (!saved || typeof saved !== "object") saved = {};
    } catch {}
    viewMemory.current = saved.views || {};
    if (saved.columns)
      setColumns({
        value: saved.columns.value === true,
        priority: saved.columns.priority !== false,
        timezone: saved.columns.timezone === true,
      });
    async function restore(initial = false) {
      const token = ++restoreSequence.current;
      const guard = navGuard.current;
      if (
        !initial &&
        (guard.dirty || guard.chatDirty || guard.saving || guard.chatBusy)
      ) {
        if (navigationUrl.current)
          window.history.pushState(null, "", navigationUrl.current);
        setToast(
          "Finish your current lead changes before using browser navigation.",
        );
        return;
      }
      const q = new URLSearchParams(window.location.search);
      const v =
        viewFromUrl(q) ||
        (initial && saved.lastView) ||
        (boot!.member.job_role === "Lead generator" ? "leads" : "day");
      const safeView = [
        "day",
        "pipeline",
        "leads",
        "analytics",
        "phone",
        "settings",
      ].includes(v)
        ? (v as View)
        : "day";
      applyView(
        safeView,
        viewFromUrl(q)
          ? stateFromUrl(q)
          : viewState(viewMemory.current[safeView]),
      );
      setNavReady(true);
      const id = q.get("lead");
      if (id && /^[a-f0-9-]{36}$/i.test(id)) {
        try {
          const result = await api<{ lead: Lead }>(
            "/api/conversation?lead=" + encodeURIComponent(id),
          );
          if (
            token === restoreSequence.current &&
            !navGuard.current.dirty &&
            !navGuard.current.chatDirty &&
            !navGuard.current.saving &&
            !navGuard.current.chatBusy
          )
            openLead(result.lead);
        } catch {
          setToast("That lead link is unavailable for this account.");
        }
      } else if (drawer.current?.open) {
        drawer.current.close();
        setDraft(null);
        setSelected(null);
      }
    }
    void restore(true);
    const pop = () => void restore();
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [boot?.member.email]);
  useEffect(() => {
    if (!boot || !navReady) return;
    const state = captureView();
    viewMemory.current[view] = state;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          "frontline-views:" + boot.member.email,
          JSON.stringify({
            views: viewMemory.current,
            lastView: view,
            columns,
          }),
        );
      } catch {}
      const lead = new URLSearchParams(window.location.search).get("lead");
      window.history.replaceState(null, "", stateToUrl(view, state, lead));
      navigationUrl.current = window.location.href;
    }, 300);
    return () => clearTimeout(timer);
  }, [
    boot?.member.email,
    navReady,
    view,
    search,
    scope,
    due,
    stage,
    page,
    ownerFilter,
    zoneFilter,
    workFilter,
    exactDate,
    dateField,
    archived,
    density,
    columns,
  ]);
  useEffect(() => {
    if (!loading && scrollToRestore.current !== null) {
      const y = scrollToRestore.current;
      scrollToRestore.current = null;
      const frame = requestAnimationFrame(() => window.scrollTo({ top: y }));
      return () => cancelAnimationFrame(frame);
    }
  }, [loading, leads]);
  const today = boot?.today || new Date().toISOString().slice(0, 10);
  useEffect(() => {
    if (search === query) return;
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const [boardRevision, setBoardRevision] = useState(0);
  async function connect() {
    setAccessError("");
    listCache.current.clear();
    reportAt.current = 0;
    setLoading(true);
    try {
      setBoot(await api<Bootstrap>("/api/bootstrap"));
      setBoardRevision((n) => n + 1);
    } catch (e) {
      setAccessError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    connect();
  }, []);
  async function refreshReport(force = false) {
    if (!boot || (!force && Date.now() - reportAt.current < 15000)) return;
    const sequence = ++reportSequence.current;
    try {
      const summary = await api<Report>("/api/reports");
      if (sequence === reportSequence.current) {
        setReport(summary);
        reportAt.current = Date.now();
      }
    } catch (e) {
      if (sequence === reportSequence.current) setError((e as Error).message);
    }
  }
  function invalidateReports() {
    listCache.current.clear();
    reportAt.current = 0;
    if (reportTimer.current) clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(() => {
      void refreshReport(true);
    }, 500);
  }
  async function load(force = false) {
    if (!boot || !navReady) return;
    listAbort.current?.abort();
    const token = ++loadToken.current;
    if (["analytics", "settings", "pipeline"].includes(view)) {
      setLoading(false);
      void refreshReport(force);
      return;
    }
    const params = new URLSearchParams({
      page: String(page),
      search: query,
      scope: scope === "mine" ? "mine" : "",
      today,
      owner: ownerFilter,
      tz: zoneFilter,
      work_status: workFilter,
      date: exactDate,
      date_field: dateField,
      archived: String(archived),
    });
    if (stage) params.set("stage", stage);
    if (view === "day") params.set("due", due);
    if (view === "phone") {
      params.set("phone", "true");
      params.set("due", due === "all" ? "open" : due);
    }
    const key = boot.member.email + ":" + params.toString();
    const cached = listCache.current.get(key);
    setError("");
    if (cached && !force && Date.now() - cached.at < 15000) {
      setLeads(cached.leads);
      setTotal(cached.total);
      setLoading(false);
      void refreshReport();
      return;
    }
    const controller = new AbortController();
    listAbort.current = controller;
    setLoading(true);
    void refreshReport(force);
    try {
      const rows = await api<{ leads: Lead[]; total: number }>(
        "/api/leads?" + params,
        undefined,
        controller.signal,
      );
      if (token !== loadToken.current) return;
      const latest = new Map(currentLeads.current.map((l) => [l.id, l]));
      const merged = rows.leads.map((l) => {
        const local = latest.get(l.id);
        return local && (pending.current.has(l.id) || local.version > l.version)
          ? local
          : l;
      });
      setLeads(merged);
      setTotal(rows.total);
      if (!pending.current.size)
        listCache.current.set(key, {
          at: Date.now(),
          leads: merged,
          total: rows.total,
        });
    } catch (e) {
      if (token === loadToken.current && (e as Error).name !== "AbortError")
        setError((e as Error).message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }
  useEffect(() => {
    setChecked([]);
    void load();
  }, [
    boot,
    navReady,
    view,
    query,
    scope,
    due,
    stage,
    page,
    ownerFilter,
    zoneFilter,
    workFilter,
    exactDate,
    dateField,
    archived,
  ]);
  function navigate(v: View) {
    viewMemory.current[view] = { ...captureView(), scroll: window.scrollY };
    const next = viewState(viewMemory.current[v]);
    window.history.pushState(null, "", stateToUrl(v, next));
    applyView(v, next);
  }
  async function loadHistory(l: Lead) {
    const token = ++historyToken.current;
    setHistory([]);
    setHistoryError("Loading history…");
    try {
      const rows = await api<Activity[]>("/api/activities?lead=" + l.id);
      if (token === historyToken.current) {
        setHistory(rows);
        setHistoryError("");
      }
    } catch (e) {
      if (token === historyToken.current) setHistoryError((e as Error).message);
    }
  }
  function openLead(
    l: Lead | null = null,
    tab: "details" | "activity" = "activity",
    complete = false,
  ) {
    setChatDirty(false);
    setChatBusy(false);
    setSelected(l);
    setDraft(l ? { ...l } : emptyLead(boot!.member.email));
    setDrawerTab(l ? tab : "details");
    setComposerMode(complete ? "activity" : "note");
    setDirty(false);
    setDrawerError("");
    setDuplicateReason("");
    setActivity({
      type: complete ? "Note" : "Call",
      outcome: complete ? "Completed" : "",
      details: "",
      next_action: "",
      next_follow_up: "",
      complete,
    });
    if (l) loadHistory(l);
    else {
      historyToken.current++;
      setHistory([]);
      setHistoryError("");
    }
    drawer.current?.showModal();
    const url = new URL(window.location.href);
    if (l) url.searchParams.set("lead", l.id);
    else url.searchParams.delete("lead");
    window.history.replaceState(null, "", url);
    navigationUrl.current = url.href;
  }
  function close() {
    if (saving || chatBusy || contactBusy) return;
    if (
      (dirty || chatDirty || contactDirty) &&
      !window.confirm("Discard unsaved changes?")
    )
      return;
    drawer.current?.close();
    historyToken.current++;
    setDraft(null);
    setSelected(null);
    setDirty(false);
    clearLeadUrl();
  }
  function clearLeadUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("lead");
    window.history.replaceState(null, "", url);
    navigationUrl.current = url.href;
  }
  async function saveLead(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setDrawerError("");
    try {
      const saved = await api<Lead>("/api/leads", {
        ...draft,
        ...(selected ? { id: selected.id, version: selected.version } : {}),
        duplicate_reason: duplicateReason,
      });
      setDirty(false);
      if (chatDirty) {
        setSelected(saved);
        setDraft({ ...saved });
      } else {
        drawer.current?.close();
        setDraft(null);
        setSelected(null);
        clearLeadUrl();
      }
      setToast("Lead saved with audit history.");
      setBoardRevision((n) => n + 1);
      listCache.current.clear();
      reportAt.current = 0;
      await load(true);
      return saved;
    } catch (e) {
      setDrawerError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function record(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setDrawerError("");
    try {
      const saved = await api<Lead>("/api/activities", {
        ...activity,
        id: selected.id,
        version: selected.version,
        next_follow_up: activity.next_follow_up || null,
      });
      setDirty(false);
      setSelected(saved);
      setDraft({ ...saved });
      setActivity({
        ...activity,
        details: "",
        next_action: "",
        next_follow_up: "",
        complete: false,
      });
      setSkips((s) => [...new Set([...s, saved.id])]);
      setToast("Activity recorded. Next step saved.");
      listCache.current.clear();
      reportAt.current = 0;
      await Promise.all([load(true), loadHistory(saved)]);
    } catch (e) {
      setDrawerError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function changeLeads(
    rows: Lead[],
    action: "stage" | "work_status" | "archive" | "restore",
    value = "",
    loss = "",
  ) {
    if (!rows.length || rows.some((l) => pending.current.has(l.id))) return;
    const originals = rows.map(
      (l) => currentLeads.current.find((r) => r.id === l.id) || l,
    );
    const ids = new Set(originals.map((l) => l.id));
    ids.forEach((id) => pending.current.add(id));
    setPendingIds([...pending.current]);
    setError("");
    listCache.current.clear();
    listAbort.current?.abort();
    loadToken.current++;
    setLoading(false);
    const patch = (l: Lead): Lead =>
      action === "stage"
        ? { ...l, stage: value as Lead["stage"] }
        : action === "work_status"
          ? { ...l, work_status: value }
          : l;
    setLeads((all) => all.map((l) => (ids.has(l.id) ? patch(l) : l)));
    try {
      const saved = await api<Lead[]>("/api/leads/change", {
        action,
        items: originals.map((l) => ({ id: l.id, version: l.version })),
        ...(action === "stage"
          ? { stage: value, loss_reason: loss }
          : action === "work_status"
            ? { work_status: value }
            : {}),
      });
      const map = new Map(saved.map((l) => [l.id, l]));
      const hidden = saved.filter(
        (l) =>
          archived !== !!l.archived_at ||
          (!!stage && l.stage !== stage) ||
          (!!workFilter && l.work_status !== workFilter),
      );
      const hiddenIds = new Set(hidden.map((l) => l.id));
      setLeads((all) =>
        all.map((l) => map.get(l.id) || l).filter((l) => !hiddenIds.has(l.id)),
      );
      if (hidden.length) setTotal((n) => Math.max(0, n - hidden.length));
      setChecked([]);
      setToast(
        action === "archive"
          ? "Archived. Restore from the Archived view."
          : action === "restore"
            ? "Lead restored."
            : saved.length +
              " lead" +
              (saved.length === 1 ? "" : "s") +
              " updated.",
      );
      invalidateReports();
      return saved;
    } catch (e) {
      const map = new Map(originals.map((l) => [l.id, l]));
      setLeads((all) => all.map((l) => map.get(l.id) || l));
      setError(
        (e as Error).message +
          " No changes were applied; the original cards were restored.",
      );
      listCache.current.clear();
    } finally {
      ids.forEach((id) => pending.current.delete(id));
      setPendingIds([...pending.current]);
    }
  }
  async function move(l: Lead, next: string) {
    if (next === l.stage || pending.current.has(l.id) || l.archived_at) return;
    if (next === "Lost") {
      openLead(l);
      setDrawerTab("details");
      setDraft({ ...l, stage: "Lost" });
      setDirty(true);
      return;
    }
    return await changeLeads([l], "stage", next);
  }
  function resetFilters() {
    setSearch("");
    setQuery("");
    setStage("");
    setScope("all");
    setDue(view === "phone" ? "all" : "due");
    setOwnerFilter("");
    setZoneFilter("");
    setWorkFilter("");
    setExactDate("");
    setArchived(false);
    setPage(0);
  }
  async function copyNumber(l: Lead) {
    try {
      await navigator.clipboard.writeText(l.phone);
      setToast("Number copied. Paste it into Quo’s dialpad.");
    } catch {
      inputPhone.current?.focus();
      inputPhone.current?.select();
      setToast("Copy the selected number manually.");
    }
  }
  async function saveTeam(e: FormEvent) {
    e.preventDefault();
    setTeamBusy(true);
    setError("");
    try {
      await api("/api/team", teamDraft);
      await connect();
      setTeamDraft({
        email: "",
        display_name: "",
        role: "Agent",
        active: true,
        aliases: [],
      });
      setToast("Team access updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTeamBusy(false);
    }
  }
  async function importCsv(commit = false) {
    setImportBusy(true);
    setError("");
    try {
      const result = await api<any>("/api/import", {
        csv,
        fallback,
        dateFormat,
        source,
        commit,
      });
      if (commit) {
        setImportPreview(null);
        setCsv("");
        setToast(
          `Imported ${result.imported}; skipped ${result.skipped} existing source rows.`,
        );
        listCache.current.clear();
        reportAt.current = 0;
        await load(true);
      } else setImportPreview(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  function update<K extends keyof LeadInput>(key: K, value: LeadInput[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : null));
    setDirty(true);
  }
  const phoneQueue = leads.filter(
      (l) =>
        !skips.includes(l.id) &&
        !["Won", "Lost"].includes(l.stage) &&
        l.phone.replace(/\D/g, "").length >= 7,
    ),
    phoneLead = phoneQueue.find((l) => l.id === phoneId) || phoneQueue[0];
  const pagination = (
    <div className="pagination">
      <span>
        {total
          ? `${page * 100 + 1}–${Math.min((page + 1) * 100, total)} of ${total}`
          : "0 leads"}{" "}
        · 100 per page
      </span>
      <div className="flex">
        <button
          aria-label="Previous page"
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label="Next page"
          disabled={(page + 1) * 100 >= total || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
  const selectionRows = leads.filter((l) => checked.includes(l.id));
  const toggle = (id: string) =>
    setChecked((all) =>
      all.includes(id) ? all.filter((x) => x !== id) : [...all, id],
    );
  const activityForm = selected ? (
    <form onSubmit={record} onChange={() => setDirty(true)}>
      <h3>
        {activity.complete ? "Complete follow-up" : "Record a conversation"}
      </h3>
      <div className="form-grid">
        <Field label="Activity type">
          <select
            value={activity.type}
            onChange={(e) =>
              setActivity({
                ...activity,
                type: e.target.value,
                outcome: e.target.value === "Call" ? "" : "Completed",
              })
            }
          >
            {["Call", "Email", "Meeting"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Outcome">
          <select
            required
            value={activity.outcome}
            onChange={(e) =>
              setActivity({ ...activity, outcome: e.target.value })
            }
          >
            <option value="">Choose actual outcome</option>
            {(activity.type === "Call"
              ? [
                  "Connected",
                  "No answer",
                  "Voicemail",
                  "Not interested",
                  "Other",
                ]
              : OUTCOMES
            ).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="What happened?" full>
          <textarea
            required
            maxLength={4000}
            value={activity.details}
            onChange={(e) =>
              setActivity({ ...activity, details: e.target.value })
            }
          />
        </Field>
        <Field label="Next action (optional)">
          <input
            maxLength={300}
            value={activity.next_action}
            onChange={(e) =>
              setActivity({
                ...activity,
                next_action: e.target.value,
              })
            }
          />
        </Field>
        <Field label="Next follow-up">
          <input
            type="date"
            value={activity.next_follow_up}
            onChange={(e) =>
              setActivity({
                ...activity,
                next_follow_up: e.target.value,
              })
            }
          />
        </Field>
      </div>
      <p className="fine">
        Provide both next action and date to reschedule.{" "}
        {activity.complete
          ? "Leaving both blank clears this follow-up."
          : "Leaving both blank preserves the current follow-up."}
      </p>
      <button
        className="purple"
        disabled={
          saving || contactBusy || boot?.demo || !!selected?.archived_at
        }
      >
        {saving
          ? "Saving…"
          : activity.complete
            ? "Complete follow-up"
            : "Save activity"}
      </button>
    </form>
  ) : null;
  const leadRows = (list: Lead[]) =>
    list.map((l) => (
      <tr key={l.id} aria-busy={pendingIds.includes(l.id)}>
        <td>
          <input
            type="checkbox"
            aria-label={"Select " + l.company}
            checked={checked.includes(l.id)}
            disabled={pendingIds.includes(l.id)}
            onChange={() => toggle(l.id)}
          />
        </td>
        <td>
          <button className="text-button" onClick={() => openLead(l)}>
            {l.company}
          </button>
          <small className="legacy-detail">
            {l.legacy_id || l.id.slice(0, 8)} ·{" "}
            {l.original_created_date || l.created_at.slice(0, 10)}
          </small>
          <small
            className={
              "timezone-detail " +
              (callingInfo(l, now).open ? "calling-open" : "muted")
            }
          >
            {callingInfo(l, now).label} {callingInfo(l, now).time} ·{" "}
            {callingInfo(l, now).zone
              ? callingInfo(l, now).open
                ? "Open calling window"
                : "Closed calling window"
              : "Set lead timezone"}
          </small>
          <small>
            {l.contact || "No contact"}
            {l.email ? " · " + l.email : ""}
          </small>
        </td>
        <td>
          {boot?.members.find((m) => m.email === l.owner_email)?.display_name ||
            l.owner_email}
        </td>
        <td>
          <select
            aria-label={"Stage for " + l.company}
            value={l.stage}
            disabled={pendingIds.includes(l.id) || !!l.archived_at}
            onChange={(e) => move(l, e.target.value)}
          >
            {STAGES.map((st) => (
              <option key={st}>{st}</option>
            ))}
          </select>
          <small>
            {pendingIds.includes(l.id)
              ? "Saving…"
              : l.work_status && l.work_status !== "None"
                ? l.work_status
                : ""}
          </small>
        </td>
        <td className="value-column">{money(l.value)}</td>
        <td>
          {l.next_action || "No next action"}
          <small>{l.next_follow_up || "Unscheduled"}</small>
        </td>
        <td className="priority-column">
          <span className={l.priority === "High" ? "priority" : ""}>
            {l.priority}
          </span>
        </td>
        <td>
          <div className="row-shortcuts">
            {l.email && (
              <a href={"mailto:" + encodeURIComponent(l.email)}>Email</a>
            )}
            {l.phone && (
              <a href="quo://" aria-label={"Open Quo for " + l.company}>
                Quo
              </a>
            )}
            <RowActions
              company={l.company}
              archived={!!l.archived_at}
              disabled={pendingIds.includes(l.id)}
              onEdit={() => openLead(l, "details")}
              onHistory={() => openLead(l, "activity")}
              onArchive={() => {
                void changeLeads([l], l.archived_at ? "restore" : "archive");
              }}
            />
          </div>
        </td>
      </tr>
    ));
  if (!boot)
    return (
      <main className="login">
        <div className="login-card">
          <div className="wordmark">
            <div className="brand-identity">
              <Image
                src="/branding/frontline-logo.jpg"
                alt=""
                width={440}
                height={427}
                className="brand-logo"
              />
              <strong>
                FRONTLINE<span>·</span>
              </strong>
            </div>
          </div>
          <div className="eyebrow">CUSTOMER OPERATIONS</div>
          <h1>
            Your pipeline.
            <br />
            Your next move.
          </h1>
          <p className="muted">
            A focused workspace for the people who keep customer operations
            moving.
          </p>
          {accessError && (
            <div className="error" role="alert">
              {accessError}
            </div>
          )}
          <a href="/auth/login" className="button primary">
            Continue with Google <ArrowUpRight size={17} />
          </a>
          <button
            className="text-button muted"
            onClick={connect}
            disabled={loading}
          >
            {loading ? "Checking connection…" : "Retry connection"}
          </button>
          <p className="fine">
            Approved frontline-x.com accounts only. If this is a new
            installation, connect Supabase using the included setup guide.
          </p>
          {typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("auth") ===
              "denied" && (
              <p className="error">
                Sign-in was denied. Ask an admin to add your company account.
              </p>
            )}
        </div>
      </main>
    );
  const titles: Record<View, [string, string, string]> = {
    day: [
      "YOUR DAILY FOCUS",
      `My day, ${boot.member.display_name.split(" ")[0]}`,
      "Every conversation should have a clear next step.",
    ],
    pipeline: [
      "OPPORTUNITY MANAGEMENT",
      "Sales pipeline",
      "Move opportunities forward. Capture what matters.",
    ],
    leads: [
      "YOUR RELATIONSHIP WORKSPACE",
      "All leads",
      "Find the context, then take the next step.",
    ],
    analytics: [
      "PERFORMANCE & INSIGHT",
      "Analytics",
      "Current pipeline snapshots and recorded activity, clearly separated.",
    ],
    phone: [
      "CALLING WORKSPACE",
      "Calling workspace",
      "Work through your queue. Place calls in Quo. Record the outcome here.",
    ],
    settings: [
      "ADMIN WORKSPACE",
      "Team & settings",
      "Manage access and bring your existing leads into the new CRM.",
    ],
  };
  return (
    <div
      className="app"
      data-density={density}
      data-view={view}
      data-show-value={columns.value}
      data-show-priority={columns.priority}
      data-show-timezone={columns.timezone}
    >
      <IncomingCalls
        enabled={!boot.demo}
        blocked={!!draft || saving || chatBusy || contactBusy}
        locked={saving || chatBusy || contactBusy}
        dialog={drawer.current}
        onOpen={async (id, replace) => {
          const result = await api<{ lead: Lead }>(
            "/api/conversation?lead=" + encodeURIComponent(id),
          );
          if (callOpenGuard.current)
            throw Error("Finish saving before opening the caller");
          if (!replace && drawer.current?.open)
            throw Error("A lead is already open");
          if (!result.lead || result.lead.archived_at)
            throw Error("Lead not available");
          openLead(result.lead, "activity");
        }}
      />
      <ActiveUsage demo={boot.demo} />
      <aside className="sidebar">
        <div className="wordmark">
          <div className="brand-identity">
            <Image
              src="/branding/frontline-logo.jpg"
              alt=""
              width={440}
              height={427}
              className="brand-logo"
            />
            <strong>
              FRONTLINE<span>·</span>
            </strong>
          </div>
          <small>CUSTOMER OPERATIONS</small>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav
            .filter(([v]) => v !== "settings" || boot.member.role === "Admin")
            .map(([v, label, Icon]) => (
              <button
                key={v}
                className={view === v ? "active" : ""}
                onClick={() => navigate(v)}
              >
                <Icon size={18} />
                {label}
                {v === "day" && report && report.overdue > 0 && (
                  <span className="nav-count">{report.overdue}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">
            {boot.member.display_name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <strong>{boot.member.display_name}</strong>
            <small>{boot.member.role} · Company account</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={async () => {
              if (boot.demo) {
                setToast("Local preview uses synthetic data.");
                return;
              }
              try {
                await api("/auth/logout", {});
                window.location.assign("/");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
        <a
          className="brand-link"
          href="https://www.frontline-x.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          frontline-x.com <ArrowUpRight size={12} />
        </a>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="muted">
            Workspace <span className="divider">/</span>{" "}
            <b>{nav.find((n) => n[0] === view)?.[1]}</b>
          </span>
          <div className="flex">
            <ThemeSwitcher />
            <span className="sync" role="status" aria-live="polite">
              <i />
              {boot.demo
                ? "LOCAL PREVIEW"
                : loading
                  ? "Updating…"
                  : "Database connected"}
            </span>
            <button
              onClick={() => (view === "settings" ? connect() : load(true))}
              disabled={loading}
              aria-label="Refresh workspace"
            >
              <RefreshCw
                size={15}
                className={loading ? "refreshing-icon" : undefined}
              />
              <span>Refresh</span>
            </button>
          </div>
        </header>
        <main className="content">
          {boot.demo && (
            <div className="demo-banner">
              Local preview · Synthetic sample data · Changes are disabled until
              Supabase is connected.
            </div>
          )}
          <div className="page-head" key={view}>
            <div>
              <div className="eyebrow">{titles[view][0]}</div>
              <h1>{titles[view][1]}</h1>
              <p>{titles[view][2]}</p>
            </div>
            {view !== "analytics" && view !== "settings" && (
              <button className="primary" onClick={() => openLead()}>
                <Plus size={16} />
                New lead
              </button>
            )}
            {view === "leads" && (
              <a
                href={boot.demo ? "#" : "/api/export"}
                className="button"
                onClick={(e) => {
                  if (boot.demo) {
                    e.preventDefault();
                    setToast("Connect Supabase before exporting.");
                  }
                }}
              >
                <Download size={15} />
                Export CSV
              </a>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          )}
          <details className="company-strip">
            <summary>Company contact details</summary>
            <div>
              <span>
                {boot.workAddress ||
                  "30 N Gould St Ste N Sheridan, WY, 82801, USA"}
              </span>
              <a href={"tel:" + (boot.teamPhone || "+13074294109")}>
                Team phone: {boot.teamPhone || "+13074294109"}
              </a>
            </div>
          </details>
          {report && ["day", "pipeline", "leads"].includes(view) && (
            <Metrics
              items={
                view === "day"
                  ? [
                      ["Overdue", report.overdue, "Accessible open leads"],
                      ["Open opportunities", report.open, "Current pipeline"],
                      [
                        "Open value",
                        money(report.open_value),
                        "Unweighted opportunity value",
                      ],
                      [
                        "Without next step",
                        report.unscheduled,
                        "Need a follow-up date",
                      ],
                    ]
                  : [
                      ["Total leads", report.total, "All accessible records"],
                      [
                        "Open value",
                        money(report.open_value),
                        "Current open pipeline",
                      ],
                      [
                        "Won value",
                        money(report.won_value),
                        "Current won records",
                      ],
                      ["Won leads", report.won, "Current snapshot"],
                    ]
              }
            />
          )}
          {!["analytics", "settings"].includes(view) && (
            <>
              <div className="view-tools">
                <div
                  className="quick-views"
                  role="group"
                  aria-label="Quick lead views"
                >
                  <button
                    aria-pressed={
                      scope === "all" &&
                      !stage &&
                      !exactDate &&
                      !ownerFilter &&
                      !workFilter &&
                      !zoneFilter &&
                      !archived
                    }
                    onClick={() => {
                      resetFilters();
                      setScope("all");
                    }}
                  >
                    All accessible
                  </button>
                  <button
                    aria-pressed={
                      scope === "mine" &&
                      !stage &&
                      !exactDate &&
                      !ownerFilter &&
                      !workFilter &&
                      !zoneFilter &&
                      !archived
                    }
                    onClick={() => {
                      resetFilters();
                      setScope("mine");
                    }}
                  >
                    My leads
                  </button>
                  <button
                    aria-pressed={
                      exactDate === today && dateField === "followup"
                    }
                    onClick={() => {
                      resetFilters();
                      setDateField("followup");
                      setExactDate(today);
                    }}
                  >
                    Follow-ups today
                  </button>
                </div>
                <div
                  className="density-controls"
                  role="group"
                  aria-label="Display density"
                >
                  <button
                    aria-pressed={density === "comfortable"}
                    onClick={() => setDensity("comfortable")}
                  >
                    Comfortable
                  </button>
                  <button
                    aria-pressed={density === "compact"}
                    onClick={() => setDensity("compact")}
                  >
                    Compact
                  </button>
                </div>
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={16} />
                  <input
                    ref={searchField}
                    aria-label="Search leads"
                    placeholder="Search company, contact, email, phone, or lead ID…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label>
                  <span>Scope</span>
                  <select
                    aria-label="Lead scope"
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="mine">My leads</option>
                    <option value="all">All accessible leads</option>
                  </select>
                </label>
                {["day", "phone"].includes(view) ? (
                  <label>
                    <span>Queue</span>
                    <select
                      aria-label="Queue filter"
                      value={due}
                      onChange={(e) => {
                        setDue(e.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="due">Due & overdue</option>
                      <option value="today">Today</option>
                      <option value="overdue">Overdue</option>
                      <option value="upcoming">Upcoming</option>
                      <option value="unscheduled">Unscheduled</option>
                      {view === "phone" && (
                        <option value="all">All open leads</option>
                      )}
                    </select>
                  </label>
                ) : (
                  <label>
                    <span>Stage</span>
                    <select
                      aria-label="Stage filter"
                      value={stage}
                      onChange={(e) => {
                        setStage(e.target.value);
                        setPage(0);
                      }}
                    >
                      <option value="">All stages</option>
                      {STAGES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </>
          )}
          {!["analytics", "settings"].includes(view) && (
            <details className="filter-disclosure">
              <summary>
                <SlidersHorizontal size={14} /> More filters{" "}
                <span>
                  {[
                    ownerFilter,
                    zoneFilter,
                    workFilter,
                    exactDate,
                    archived,
                  ].filter(Boolean).length || ""}
                </span>
              </summary>
              <div className="workflow-filters">
                <label>
                  <span>Assigned agent</span>
                  <select
                    aria-label="Assigned agent filter"
                    value={ownerFilter}
                    onChange={(e) => {
                      setOwnerFilter(e.target.value);
                      setScope("all");
                      setPage(0);
                    }}
                  >
                    <option value="">All accessible agents</option>
                    {boot.members.map((m) => (
                      <option key={m.email} value={m.email}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Calling window / timezone</span>
                  <select
                    aria-label="Calling window filter"
                    value={zoneFilter}
                    onChange={(e) => {
                      setZoneFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">All timezones</option>
                    <option value="calling">Open calling windows now</option>
                    <option value="unknown">Timezone unknown</option>
                    {ZONES.map(([z, label]) => (
                      <option key={z} value={z}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Work category</span>
                  <select
                    aria-label="Work category filter"
                    value={workFilter}
                    onChange={(e) => {
                      setWorkFilter(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">All categories</option>
                    {WORK_STATUSES.map((w) => (
                      <option key={w}>{w}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Date field</span>
                  <select
                    aria-label="Specific date field"
                    value={dateField}
                    onChange={(e) => {
                      setDateField(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="created">Original / created date</option>
                    <option value="followup">Follow-up date</option>
                  </select>
                </label>
                <label>
                  <span>Specific date</span>
                  <input
                    type="date"
                    aria-label="Specific date"
                    value={exactDate}
                    onChange={(e) => {
                      setExactDate(e.target.value);
                      setPage(0);
                    }}
                  />
                </label>
                {view === "leads" && (
                  <label>
                    <span>Records</span>
                    <select
                      aria-label="Archive filter"
                      value={String(archived)}
                      onChange={(e) => {
                        setArchived(e.target.value === "true");
                        setPage(0);
                      }}
                    >
                      <option value="false">Current leads</option>
                      <option value="true">Archived leads</option>
                    </select>
                  </label>
                )}
                <button onClick={resetFilters}>Reset filters</button>
                <span className="fine">
                  Calling window: Mon–Fri, 9am–5pm in the lead's local time.
                  Unknown and split-state locations require a chosen timezone.
                </span>
              </div>
            </details>
          )}
          {!["analytics", "settings"].includes(view) && (
            <div className="active-filter-chips" aria-label="Active filters">
              {[
                {
                  value: stage,
                  label: "Stage: " + stage,
                  clear: () => setStage(""),
                },
                {
                  value: ownerFilter,
                  label:
                    "Owner: " +
                    (boot.members.find((m) => m.email === ownerFilter)
                      ?.display_name || ownerFilter),
                  clear: () => setOwnerFilter(""),
                },
                {
                  value: zoneFilter,
                  label: "Timezone: " + zoneFilter,
                  clear: () => setZoneFilter(""),
                },
                {
                  value: workFilter,
                  label: "Category: " + workFilter,
                  clear: () => setWorkFilter(""),
                },
                {
                  value: exactDate,
                  label: "Date: " + exactDate,
                  clear: () => setExactDate(""),
                },
              ]
                .filter((f) => f.value)
                .map((f) => (
                  <button
                    key={f.label}
                    onClick={() => {
                      f.clear();
                      setPage(0);
                    }}
                    aria-label={"Remove " + f.label}
                  >
                    {f.label} ×
                  </button>
                ))}
            </div>
          )}
          {view === "day" && (
            <div className="day-layout">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Your next moves</h3>
                    <p>
                      {today} · {boot.timeZone}
                    </p>
                  </div>
                  <span className="badge">
                    {loading ? "Updating…" : total + " follow-ups"}
                  </span>
                </div>
                {loading ? (
                  <div className="empty">Loading your queue…</div>
                ) : leads.length ? (
                  leads.map((l) => (
                    <div key={l.id} className="task-row">
                      <div
                        className={
                          "task-icon " +
                          (l.next_follow_up && l.next_follow_up < today
                            ? "late"
                            : "")
                        }
                      >
                        <Clock3 size={18} />
                      </div>
                      <div className="grow">
                        <button
                          className="text-button"
                          onClick={() => openLead(l)}
                        >
                          {l.company}
                        </button>
                        <p>
                          {l.next_action || "Set a clear next action"} ·{" "}
                          {l.contact || "No contact name"}
                        </p>
                        <small>
                          {l.next_follow_up || "Unscheduled"} · {l.stage}
                        </small>
                      </div>
                      <div className="task-actions">
                        <button onClick={() => openLead(l, "activity")}>
                          Log activity
                        </button>
                        {l.next_follow_up && (
                          <button
                            aria-label={"Complete follow-up for " + l.company}
                            onClick={() => openLead(l, "activity", true)}
                          >
                            <Check size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty">
                    You’re clear for this queue.
                    <br />
                    Change the filter to plan what comes next.
                  </div>
                )}
                {pagination}
              </section>
              <div>
                <section className="panel quick-queues">
                  <h3>Work queues</h3>
                  <button
                    onClick={() => {
                      setDue("overdue");
                      setPage(0);
                    }}
                  >
                    Overdue follow-ups
                  </button>
                  <button
                    onClick={() => {
                      setDue("unscheduled");
                      setPage(0);
                    }}
                  >
                    Needs a next step
                  </button>
                  <button
                    onClick={() => {
                      navigate("phone");
                      setZoneFilter("calling");
                      setDue("all");
                    }}
                  >
                    Callable now
                  </button>
                  <p className="fine">
                    All leads remain accessible. Choose My leads for your
                    assigned work.
                  </p>
                </section>
                {report && (
                  <Bars
                    title="Pipeline pulse"
                    subtitle="All accessible leads · current snapshot"
                    rows={report.stages}
                    onSelect={(label) => {
                      navigate("pipeline");
                      setStage(label);
                      setScope("all");
                    }}
                  />
                )}
                <div className="quiet-card">
                  <div className="eyebrow">ONE OPERATION. CLEAR OUTCOMES.</div>
                  <h3>
                    Log the conversation.
                    <br />
                    Set the next move.
                  </h3>
                  <p>
                    Calls, emails, and meetings live in the activity timeline.
                    Pipeline stages track progress toward a sale.
                  </p>
                  <ArrowUpRight size={26} />
                </div>
              </div>
            </div>
          )}
          {view === "leads" && (
            <section className="panel">
              <div className="panel-head">
                <h3>{loading ? "Updating leads…" : total + " leads"}</h3>
                <details className="column-picker">
                  <summary>Columns</summary>
                  {(["value", "priority", "timezone"] as const).map((key) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={columns[key]}
                        onChange={(e) =>
                          setColumns((c) => ({ ...c, [key]: e.target.checked }))
                        }
                      />
                      {key === "value"
                        ? "Deal value"
                        : key === "priority"
                          ? "Priority"
                          : "Calling timezone"}
                    </label>
                  ))}
                </details>
                <span className="muted">
                  Open a company to see the full context
                </span>
              </div>
              <div className="bulk-controls" data-selected={checked.length}>
                <label>
                  <input
                    type="checkbox"
                    aria-label="Select all leads on this page"
                    checked={
                      leads.length > 0 && checked.length === leads.length
                    }
                    onChange={(e) =>
                      setChecked(e.target.checked ? leads.map((l) => l.id) : [])
                    }
                  />{" "}
                  Select page
                </label>
                <span>{checked.length} selected</span>
                {!archived && (
                  <>
                    <select
                      aria-label="Bulk stage"
                      value={bulkStage}
                      onChange={(e) => setBulkStage(e.target.value)}
                    >
                      <option value="">Move selected to stage…</option>
                      {STAGES.map((st) => (
                        <option key={st}>{st}</option>
                      ))}
                    </select>
                    {bulkStage === "Lost" && (
                      <input
                        aria-label="Bulk loss reason"
                        placeholder="Loss reason for selected leads"
                        value={bulkLoss}
                        onChange={(e) => setBulkLoss(e.target.value)}
                        maxLength={500}
                      />
                    )}
                    <button
                      disabled={
                        !checked.length ||
                        !bulkStage ||
                        !!pendingIds.length ||
                        (bulkStage === "Lost" && !bulkLoss.trim())
                      }
                      onClick={() =>
                        changeLeads(selectionRows, "stage", bulkStage, bulkLoss)
                      }
                    >
                      Apply stage
                    </button>
                    <select
                      aria-label="Bulk work category"
                      value={bulkWork}
                      onChange={(e) => setBulkWork(e.target.value)}
                    >
                      <option value="">Work category…</option>
                      {WORK_STATUSES.map((w) => (
                        <option key={w}>{w}</option>
                      ))}
                    </select>
                    <button
                      disabled={
                        !checked.length || !bulkWork || !!pendingIds.length
                      }
                      onClick={() =>
                        changeLeads(selectionRows, "work_status", bulkWork)
                      }
                    >
                      Apply category
                    </button>
                  </>
                )}
                <button
                  disabled={!checked.length || !!pendingIds.length}
                  onClick={() =>
                    changeLeads(selectionRows, archived ? "restore" : "archive")
                  }
                >
                  {archived ? "Restore selected" : "Archive selected"}
                </button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Select",
                        "Company / contact",
                        "Owner",
                        "Stage",
                        "Value",
                        "Next move",
                        "Priority",
                        "Actions",
                      ].map((s) => (
                        <th
                          key={s}
                          className={
                            s === "Value"
                              ? "value-column"
                              : s === "Priority"
                                ? "priority-column"
                                : ""
                          }
                        >
                          {s}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{leadRows(leads)}</tbody>
                </table>
              </div>
              {!leads.length && (
                <div className="empty">
                  {loading
                    ? "Loading leads…"
                    : "No matching leads. Clear your filters or add a lead."}
                </div>
              )}
              {pagination}
            </section>
          )}
          {view === "pipeline" && (
            <PipelineBoard
              filters={new URLSearchParams({
                search: query,
                scope: scope === "mine" ? "mine" : "",
                owner: ownerFilter,
                tz: zoneFilter,
                work_status: workFilter,
                date: exactDate,
                date_field: dateField,
                stage,
                today,
              }).toString()}
              revision={boardRevision}
              members={boot.members}
              onOpen={(l) => openLead(l)}
              onMove={move}
            />
          )}
          {view === "analytics" && (
            <>
              <AdvancedAnalytics
                onQueue={(queue) => {
                  navigate("day");
                  setDue(queue);
                  setScope("all");
                  setPage(0);
                }}
                onLead={async (id) => {
                  try {
                    const result = await api<{ lead: Lead }>(
                      "/api/conversation?lead=" + encodeURIComponent(id),
                    );
                    openLead(result.lead, "activity");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
                boot={boot}
                onStage={(label) => {
                  navigate("leads");
                  setStage(label);
                  setScope("all");
                }}
              />
            </>
          )}
          {view === "phone" && (
            <>
              <div
                className="workspace-tabs"
                role="tablist"
                aria-label="Calling workspace sections"
              >
                {["Queue", "History & integration"].map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={phoneTab === t}
                    onClick={() => setPhoneTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {phoneTab === "History & integration" ? (
                <QuoDashboard boot={boot} />
              ) : (
                <>
                  <div className="queue-toolbar">
                    <span>
                      Calls run in Quo. Register each call for shared-account
                      attribution.
                    </span>
                    <button onClick={() => setSkips([])}>
                      Reset skipped leads
                    </button>
                  </div>
                  <div className="day-layout">
                    <section className="panel">
                      <div className="panel-head">
                        <h3>Calling queue</h3>
                        <span className="badge">Manual workflow</span>
                      </div>
                      <div className="phone-current">
                        {phoneLead ? (
                          <>
                            <div className="eyebrow">
                              {phoneLead.stage} · {phoneLead.priority} PRIORITY
                            </div>
                            <h2>{phoneLead.company}</h2>
                            <p>{phoneLead.contact || "No contact name"}</p>
                            <input
                              ref={inputPhone}
                              aria-label="Lead phone number"
                              className="phone-number"
                              readOnly
                              value={phoneLead.phone}
                            />
                            <p className="muted">
                              {phoneLead.next_action || "No next action"} ·{" "}
                              {phoneLead.next_follow_up || "Unscheduled"}
                            </p>
                            <div className="flex wrap">
                              <CallingSession boot={boot} lead={phoneLead} />
                              <button onClick={() => copyNumber(phoneLead)}>
                                <Copy size={15} />
                                Copy number
                              </button>
                              <a className="button purple" href="quo://">
                                Open Quo <ArrowUpRight size={15} />
                              </a>
                              <button
                                className="primary"
                                onClick={() => {
                                  openLead(phoneLead, "activity");
                                  setComposerMode("activity");
                                }}
                              >
                                Record outcome <ArrowRight size={15} />
                              </button>
                              <button
                                onClick={() =>
                                  setSkips((s) => [...s, phoneLead.id])
                                }
                              >
                                Skip for now
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="empty">
                            {loading
                              ? "Loading queue…"
                              : "No callable leads left on this page. Change filters, reset skips, or go to the next page."}
                          </div>
                        )}
                      </div>
                      {phoneQueue.slice(0, 15).map((l) => (
                        <div className="phone-list-row" key={l.id}>
                          <button
                            className="text-button"
                            onClick={() => setPhoneId(l.id)}
                          >
                            {l.company}
                          </button>
                          <small>{l.next_follow_up || "Unscheduled"}</small>
                        </div>
                      ))}
                      {pagination}
                    </section>
                    <div>
                      {report && (
                        <>
                          <Bars
                            title="Call outcomes"
                            subtitle="All time · manually recorded"
                            rows={report.outcomes}
                          />
                          <Bars title="Calls by agent" rows={report.agents} />
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {view === "settings" && (
            <div
              className="workspace-tabs"
              role="tablist"
              aria-label="Settings sections"
            >
              {["Team", "Company", "Integrations", "Data tools", "Preferences"]
                .filter(
                  (t) =>
                    boot.member.role === "Admin" ||
                    t === "Preferences" ||
                    t === "Company",
                )
                .map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={settingsTab === t}
                    onClick={() => setSettingsTab(t)}
                  >
                    {t}
                  </button>
                ))}
            </div>
          )}
          {view === "settings" && settingsTab === "Company" && (
            <section className="panel settings-panel">
              <h3>Company profile</h3>
              <p>{boot.workAddress}</p>
              <a href={"tel:" + boot.teamPhone}>{boot.teamPhone}</a>
              <p className="fine">
                Company details are shared across this workspace.
              </p>
            </section>
          )}
          {view === "settings" && settingsTab === "Preferences" && (
            <section className="panel settings-panel">
              <h3>Your workspace</h3>
              <ThemeSwitcher />
              <p>
                Your theme, list density, columns and filters are remembered on
                this device for your account.
              </p>
              <p>
                Ctrl/Cmd+K or / focuses search. Lead profiles can be shared
                using Copy lead link.
              </p>
            </section>
          )}
          {view === "settings" &&
            settingsTab === "Integrations" &&
            boot.member.role === "Admin" && <QuoDashboard boot={boot} />}
          {view === "settings" &&
            settingsTab === "Data tools" &&
            boot.member.role === "Admin" && <Reconciliation />}
          {view === "settings" && boot.member.role === "Admin" && (
            <div className="settings-grid" data-settings-tab={settingsTab}>
              <section
                className="panel settings-panel team-settings"
                hidden={settingsTab !== "Team"}
              >
                <h3>Team access</h3>
                <p>
                  Only approved frontline-x.com Google accounts can enter. Every
                  active team member can view and work on all leads. Owners
                  track responsibility; only admins manage team access and
                  reassign leads.
                </p>
                <div className="team-list">
                  {boot.members.map((m) => (
                    <div className="team-row" key={m.email}>
                      <div>
                        <strong>{m.display_name}</strong>
                        <small>{m.email}</small>
                        <small>
                          {m.role} · {m.job_role || "Other"} ·{" "}
                          {m.active ? "Active" : "Disabled"}
                        </small>
                      </div>
                      <button onClick={() => setTeamDraft({ ...m })}>
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
                <form onSubmit={saveTeam} className="form-grid">
                  <Field label="Company email" full>
                    <input
                      type="email"
                      required
                      value={teamDraft.email}
                      onChange={(e) =>
                        setTeamDraft({ ...teamDraft, email: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Display name">
                    <input
                      required
                      maxLength={80}
                      value={teamDraft.display_name}
                      onChange={(e) =>
                        setTeamDraft({
                          ...teamDraft,
                          display_name: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Access level">
                    <select
                      value={teamDraft.role}
                      onChange={(e) =>
                        setTeamDraft({
                          ...teamDraft,
                          role: e.target.value as Member["role"],
                        })
                      }
                    >
                      <option>Agent</option>
                      <option>Admin</option>
                    </select>
                  </Field>
                  <Field label="Job function">
                    <select
                      value={teamDraft.job_role || "Other"}
                      onChange={(e) =>
                        setTeamDraft({
                          ...teamDraft,
                          job_role: e.target.value as Member["job_role"],
                        })
                      }
                    >
                      <option value="Other">Other / Administration</option>
                      <option value="Lead generator">Lead generator</option>
                      <option value="Sales rep">Sales rep</option>
                    </select>
                  </Field>
                  <Field label="Legacy owner aliases (comma separated)" full>
                    <input
                      value={teamDraft.aliases.join(",")}
                      onChange={(e) =>
                        setTeamDraft({
                          ...teamDraft,
                          aliases: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                  <Field label="Account status">
                    <select
                      value={String(teamDraft.active)}
                      onChange={(e) =>
                        setTeamDraft({
                          ...teamDraft,
                          active: e.target.value === "true",
                        })
                      }
                    >
                      <option value="true">Active</option>
                      <option value="false">Disabled</option>
                    </select>
                  </Field>
                  <div className="field">
                    <span>&nbsp;</span>
                    <button className="primary" disabled={teamBusy}>
                      Save team member
                    </button>
                  </div>
                </form>
              </section>
              <section
                className="panel settings-panel import-settings"
                hidden={settingsTab !== "Data tools"}
              >
                <h3>Import from Google Sheets</h3>
                <p>
                  Export the lead tab as CSV. Review mappings and errors before
                  writing. The import is atomic; repeated source IDs are
                  skipped.
                </p>
                <div className="form-grid">
                  <Field label="Lead-tab CSV" full>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={async (e) => {
                        setImportPreview(null);
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 2000000) {
                            setError("CSV must be under 2 MB");
                            return;
                          }
                          setCsv(await file.text());
                        }
                      }}
                    />
                  </Field>
                  <Field label="Import source name" full>
                    <input
                      value={source}
                      onChange={(e) => {
                        setSource(e.target.value);
                        setImportPreview(null);
                      }}
                    />
                    <small>Keep the same source name on retries.</small>
                  </Field>
                  <Field label="Source CSV date format" full>
                    <select
                      value={dateFormat}
                      onChange={(e) => {
                        setDateFormat(e.target.value as "ISO" | "MDY" | "DMY");
                        setImportPreview(null);
                      }}
                    >
                      <option value="ISO">YYYY-MM-DD</option>
                      <option value="MDY">MM/DD/YYYY</option>
                      <option value="DMY">DD/MM/YYYY</option>
                    </select>
                  </Field>
                  <Field label="Fallback for unmapped owners" full>
                    <select
                      value={fallback}
                      onChange={(e) => {
                        setFallback(e.target.value);
                        setImportPreview(null);
                      }}
                    >
                      <option value="">Require every owner to match</option>
                      {boot.members
                        .filter((m) => m.active)
                        .map((m) => (
                          <option key={m.email} value={m.email}>
                            {m.display_name}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <button
                  className="purple"
                  disabled={!csv || importBusy}
                  onClick={() => importCsv()}
                >
                  <Upload size={16} />
                  Preview import
                </button>
                {importPreview && (
                  <div className="import-preview">
                    <h3>
                      {importPreview.total} rows · {importPreview.errors.length}{" "}
                      errors
                    </h3>
                    {importPreview.errors.slice(0, 15).map((e, i) => (
                      <p className="error" key={i}>
                        {e}
                      </p>
                    ))}
                    {importPreview.warnings.slice(0, 15).map((w, i) => (
                      <p className="fine" key={i}>
                        {w}
                      </p>
                    ))}
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Company</th>
                            <th>Owner</th>
                            <th>Stage</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importPreview.rows.map((r, i) => (
                            <tr key={i}>
                              <td>{String(r.company)}</td>
                              <td>{String(r.owner_email)}</td>
                              <td>{String(r.stage)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="fine">
                      Showing up to 10 sample rows. Historical stage and close
                      dates remain unknown. Activity history is not imported by
                      this lead CSV.
                    </p>
                    <button
                      disabled={
                        !!importPreview.errors.length ||
                        importBusy ||
                        !importPreview.total
                      }
                      className="primary"
                      onClick={() => importCsv(true)}
                    >
                      Import reviewed rows
                    </button>
                  </div>
                )}
                <div className="notice">
                  This app uses PostgreSQL as its source of truth. Sheets
                  exports are for migration and reporting. Configure backups and
                  test a restore before moving your team to production.
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
      <dialog
        ref={drawer}
        className="drawer"
        aria-labelledby="drawer-title"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="drawer-head">
          <div className="flex between">
            <div className="lead-identity">
              <h2 id="drawer-title">{selected?.company || "New lead"}</h2>
              <span className="eyebrow">
                {selected
                  ? "OPPORTUNITY · " + selected.id.slice(0, 8)
                  : "NEW OPPORTUNITY"}
              </span>
            </div>
            <button
              aria-label="Close lead"
              onClick={close}
              disabled={saving || chatBusy || contactBusy}
            >
              <X size={16} />
              Close
            </button>
          </div>
          {selected && (
            <div className="detail-actions">
              {selected.email && (
                <a
                  className="button"
                  href={"mailto:" + encodeURIComponent(selected.email)}
                >
                  Email contact <ArrowUpRight size={14} />
                </a>
              )}
              {selected.phone && (
                <a className="button" href="quo://">
                  Open Quo app <Phone size={14} />
                </a>
              )}
            </div>
          )}
          {selected && <CallingSession boot={boot} lead={selected} />}
          {selected && (
            <CallScript lead={selected} agent={boot.member.display_name} />
          )}
          <div className="drawer-tabs">
            <button
              className={drawerTab === "details" ? "active" : ""}
              onClick={() => {
                if ((dirty || contactDirty) && drawerTab === "activity") {
                  setDrawerError("Save this activity before changing tabs.");
                  return;
                }
                setDrawerTab("details");
              }}
            >
              Edit details
            </button>
            <button
              disabled={!selected || !!selected.archived_at}
              className={drawerTab === "activity" ? "active" : ""}
              onClick={() => {
                if (dirty && drawerTab === "details") {
                  setDrawerError(
                    "Save lead edits before recording an activity.",
                  );
                  return;
                }
                setDrawerTab("activity");
              }}
            >
              Overview & conversation
            </button>
          </div>
        </div>
        <div className={"drawer-body " + (selected ? "lead-full-layout" : "")}>
          <fieldset className="lead-edit-pane" disabled={chatBusy || saving}>
            {drawerError && (
              <div className="error" role="alert">
                {drawerError}
              </div>
            )}
            {draft && drawerTab === "details" && (
              <form onSubmit={saveLead}>
                <div className="form-grid">
                  <div className="section-label">RELATIONSHIP</div>
                  <Field label="Company" full>
                    <input
                      aria-label="Company"
                      required
                      maxLength={200}
                      value={draft.company}
                      onChange={(e) => update("company", e.target.value)}
                    />
                  </Field>
                  {(
                    [
                      "contact",
                      "job_title",
                      "email",
                      "phone",
                      "country",
                      "industry",
                      "source",
                    ] as const
                  ).map((key) => (
                    <Field
                      key={key}
                      label={
                        {
                          contact: "Contact name",
                          job_title: "Job title",
                          email: "Email",
                          phone: "Phone",
                          country: "Country",
                          industry: "Industry",
                          source: "Source",
                        }[key]
                      }
                    >
                      <input
                        type={
                          key === "email"
                            ? "email"
                            : key === "phone"
                              ? "tel"
                              : "text"
                        }
                        value={draft[key]}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    </Field>
                  ))}
                  <Field label="Lead timezone">
                    <select
                      value={draft.time_zone || ""}
                      onChange={(e) => update("time_zone", e.target.value)}
                    >
                      <option value="">
                        Auto from unambiguous US state / unknown
                      </option>
                      {ZONES.map(([z, label]) => (
                        <option key={z} value={z}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Work category">
                    <select
                      value={draft.work_status || "None"}
                      onChange={(e) => update("work_status", e.target.value)}
                    >
                      {WORK_STATUSES.map((w) => (
                        <option key={w}>{w}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Score (0–100)">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.score ?? ""}
                      onChange={(e) =>
                        update(
                          "score",
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                  <div className="section-label">OPPORTUNITY</div>
                  <Field label="Stage">
                    <select
                      value={draft.stage}
                      onChange={(e) =>
                        update("stage", e.target.value as Lead["stage"])
                      }
                    >
                      {STAGES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Deal value (USD)">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.value}
                      onChange={(e) => update("value", Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Priority">
                    <select
                      value={draft.priority}
                      onChange={(e) =>
                        update("priority", e.target.value as Lead["priority"])
                      }
                    >
                      <option>High</option>
                      <option>Medium</option>
                      <option>Low</option>
                    </select>
                  </Field>
                  <Field label="Status">
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        update("status", e.target.value as Lead["status"])
                      }
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                      <option>Pending</option>
                    </select>
                  </Field>
                  <Field label="Owner" full>
                    <select
                      disabled={boot.member.role !== "Admin"}
                      value={draft.owner_email}
                      onChange={(e) => update("owner_email", e.target.value)}
                    >
                      {boot.members
                        .filter(
                          (m) => m.active || m.email === draft.owner_email,
                        )
                        .map((m) => (
                          <option key={m.email} value={m.email}>
                            {m.display_name}
                            {!m.active ? " (disabled)" : ""}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {draft.stage === "Lost" && (
                    <Field label="Loss reason" full>
                      <textarea
                        required
                        maxLength={500}
                        value={draft.loss_reason}
                        onChange={(e) => update("loss_reason", e.target.value)}
                      />
                    </Field>
                  )}
                  <div className="section-label">NEXT MOVE</div>
                  <Field label="Next action">
                    <input
                      maxLength={300}
                      value={draft.next_action}
                      onChange={(e) => update("next_action", e.target.value)}
                    />
                  </Field>
                  <Field label="Follow-up date">
                    <input
                      type="date"
                      value={draft.next_follow_up || ""}
                      onChange={(e) =>
                        update("next_follow_up", e.target.value || null)
                      }
                    />
                  </Field>
                  <Field
                    label={
                      selected ? "Earlier notes (preserved)" : "Initial notes"
                    }
                    full
                  >
                    <textarea
                      maxLength={10000}
                      value={draft.notes}
                      readOnly={!!selected}
                      onChange={(e) => update("notes", e.target.value)}
                    />
                  </Field>
                  {boot.member.role === "Admin" &&
                    drawerError.includes("DUPLICATE") && (
                      <Field
                        label="Reason to keep this as a separate lead"
                        full
                      >
                        <input
                          required
                          maxLength={300}
                          value={duplicateReason}
                          onChange={(e) => setDuplicateReason(e.target.value)}
                        />
                      </Field>
                    )}
                </div>
                {selected && (
                  <p className="fine metadata">
                    Version {selected.version} · Updated{" "}
                    {new Date(selected.updated_at).toLocaleString()}
                    <br />
                    Original created date:{" "}
                    {selected.original_created_date || "Not imported"}
                    {selected.legacy_id && (
                      <>
                        <br />
                        Legacy ID: {selected.legacy_id} · Original stage:{" "}
                        {selected.legacy_stage}
                      </>
                    )}
                  </p>
                )}
                <div className="form-actions">
                  <button type="button" onClick={close} disabled={saving}>
                    Cancel
                  </button>
                  <button
                    className="primary"
                    disabled={
                      saving ||
                      contactBusy ||
                      boot.demo ||
                      !!selected?.archived_at
                    }
                  >
                    {saving
                      ? "Saving…"
                      : selected
                        ? "Save changes"
                        : "Create lead"}
                  </button>
                </div>
              </form>
            )}
            {drawerTab === "activity" && selected && (
              <>
                <LeadSummary
                  lead={selected}
                  boot={boot}
                  contactDisabled={dirty || chatDirty || saving}
                  onContactDirty={setContactDirty}
                  onContactBusy={setContactBusy}
                  onContactsSaved={() => {
                    void loadHistory(selected);
                    window.dispatchEvent(new Event("lead-contact-saved"));
                  }}
                  onEdit={() => {
                    if (dirty || contactDirty) {
                      setDrawerError("Save this activity first.");
                      return;
                    }
                    setDrawerTab("details");
                  }}
                  onActivity={() => setComposerMode("activity")}
                  onCopyLink={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      setToast("Lead link copied.");
                    } catch {
                      setToast("Copy the address from your browser.");
                    }
                  }}
                />
              </>
            )}
          </fieldset>
          {selected && (
            <LeadConversation
              key={selected.id}
              activityForm={activityForm}
              composerMode={composerMode}
              onComposerMode={setComposerMode}
              lead={selected}
              boot={boot}
              disabled={dirty || saving || contactDirty || contactBusy}
              onDraftChange={setChatDirty}
              onBusyChange={setChatBusy}
              onSaved={(saved) => {
                setSelected(saved);
                setDraft({ ...saved });
                listCache.current.clear();
                reportAt.current = 0;
                void load(true);
                void loadHistory(saved);
              }}
            />
          )}
        </div>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
