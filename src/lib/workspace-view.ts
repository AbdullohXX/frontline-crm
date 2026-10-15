export const VIEWS = [
  "day",
  "pipeline",
  "leads",
  "analytics",
  "phone",
  "settings",
] as const;
export type WorkspaceView = (typeof VIEWS)[number];
export type ViewState = {
  search: string;
  scope: string;
  due: string;
  stage: string;
  page: number;
  owner: string;
  zone: string;
  work: string;
  date: string;
  dateField: string;
  archived: boolean;
  density: "comfortable" | "compact";
  scroll: number;
};
export function viewState(input: Partial<ViewState> = {}): ViewState {
  input = input && typeof input === "object" ? input : {};
  const str = (v: unknown, max = 200) =>
    typeof v === "string" ? v.slice(0, max) : "";
  return {
    search: str(input.search),
    scope: input.scope === "mine" ? "mine" : "all",
    due: ["due", "today", "overdue", "upcoming", "unscheduled", "all"].includes(
      input.due || "",
    )
      ? input.due!
      : "due",
    stage: str(input.stage, 40),
    page: Number.isFinite(Number(input.page))
      ? Math.max(0, Math.min(10000, Math.floor(Number(input.page))))
      : 0,
    owner: str(input.owner),
    zone: str(input.zone, 60),
    work: str(input.work, 60),
    date:
      /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") &&
      Number.isFinite(Date.parse(input.date!)) &&
      new Date(input.date!).toISOString().slice(0, 10) === input.date
        ? input.date!
        : "",
    dateField: input.dateField === "followup" ? "followup" : "created",
    archived: input.archived === true,
    density: input.density === "compact" ? "compact" : "comfortable",
    scroll: Math.max(0, Math.min(100000, Number(input.scroll) || 0)),
  };
}
export function viewFromUrl(q: URLSearchParams): WorkspaceView | null {
  return VIEWS.includes(q.get("view") as WorkspaceView)
    ? (q.get("view") as WorkspaceView)
    : null;
}
export function stateFromUrl(q: URLSearchParams): ViewState {
  return viewState({
    search: q.get("search") || "",
    scope: q.get("scope") || "",
    due: q.get("due") || "",
    stage: q.get("stage") || "",
    page: Number(q.get("page")),
    owner: q.get("owner") || "",
    zone: q.get("zone") || "",
    work: q.get("work") || "",
    date: q.get("date") || "",
    dateField: q.get("dateField") || "",
    archived: q.get("archived") === "true",
    density: q.get("density") as ViewState["density"],
  });
}
export function stateToUrl(
  view: WorkspaceView,
  state: ViewState,
  lead?: string | null,
) {
  const q = new URLSearchParams({ view });
  for (const [key, value] of Object.entries(state))
    if (key !== "scroll" && value !== "" && value !== false && value !== 0)
      q.set(key, String(value));
  if (lead) q.set("lead", lead);
  return "/?" + q.toString();
}
