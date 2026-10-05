import type { Lead } from "./types";
export const WORK_STATUSES = [
  "None",
  "Email sent",
  "AI voicemail",
  "Follow-up",
  "Not ready",
  "Not valid",
] as const;
export const ZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Phoenix", "Arizona"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;
// Split-timezone states are deliberately unknown until an agent chooses the actual zone.
export const STATE_ZONES: Record<string, string> = Object.fromEntries(
  [
    ["America/New_York", "CT DE GA MA MD ME NH NJ NY NC OH PA RI SC VA VT WV"],
    ["America/Chicago", "AL AR IA IL LA MN MO MS OK WI"],
    ["America/Denver", "CO MT NM UT WY"],
    ["America/Los_Angeles", "CA NV WA"],
    ["America/Phoenix", "AZ"],
    ["Pacific/Honolulu", "HI"],
  ].flatMap(([zone, states]) =>
    states.split(" ").map((state) => [state, zone]),
  ),
);
export function leadZone(lead: Pick<Lead, "country"> & { time_zone?: string }) {
  if (lead.time_zone && ZONES.some(([z]) => z === lead.time_zone))
    return lead.time_zone;
  const match = lead.country
    .toUpperCase()
    .trim()
    .match(/^(?:US|USA|UNITED STATES)\s*[-,/]\s*([A-Z]{2})$/);
  return match ? STATE_ZONES[match[1]] || "" : "";
}
export function callingInfo(
  lead: Pick<Lead, "country"> & { time_zone?: string },
  now = new Date(),
) {
  const zone = leadZone(lead);
  if (!zone)
    return { zone: "", label: "Timezone unknown", open: false, time: "" };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const hour = Number(part("hour"));
  return {
    zone,
    label: ZONES.find(([z]) => z === zone)?.[1] || zone,
    open: !["Sat", "Sun"].includes(part("weekday")) && hour >= 9 && hour < 17,
    time: `${part("hour")}:${part("minute")}`,
  };
}
export function workStatusFromLegacy(
  value: string,
): (typeof WORK_STATUSES)[number] {
  const v = value
    .toLowerCase()
    .trim()
    .replaceAll("/", " ")
    .replaceAll("-", " ");
  return (
    WORK_STATUSES.find((s) => s.toLowerCase().replaceAll("-", " ") === v) ||
    "None"
  );
}
