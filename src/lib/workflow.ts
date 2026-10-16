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
export const STATE_ZONES: Record<string, string> = {
  CT: "America/New_York",
  CONNECTICUT: "America/New_York",
  DE: "America/New_York",
  DELAWARE: "America/New_York",
  GA: "America/New_York",
  GEORGIA: "America/New_York",
  MA: "America/New_York",
  MASSACHUSETTS: "America/New_York",
  MD: "America/New_York",
  MARYLAND: "America/New_York",
  ME: "America/New_York",
  MAINE: "America/New_York",
  NH: "America/New_York",
  "NEW HAMPSHIRE": "America/New_York",
  NJ: "America/New_York",
  "NEW JERSEY": "America/New_York",
  NY: "America/New_York",
  "NEW YORK": "America/New_York",
  NC: "America/New_York",
  "NORTH CAROLINA": "America/New_York",
  OH: "America/New_York",
  OHIO: "America/New_York",
  PA: "America/New_York",
  PENNSYLVANIA: "America/New_York",
  RI: "America/New_York",
  "RHODE ISLAND": "America/New_York",
  SC: "America/New_York",
  "SOUTH CAROLINA": "America/New_York",
  VA: "America/New_York",
  VIRGINIA: "America/New_York",
  VT: "America/New_York",
  VERMONT: "America/New_York",
  WV: "America/New_York",
  "WEST VIRGINIA": "America/New_York",
  DC: "America/New_York",
  "DISTRICT OF COLUMBIA": "America/New_York",
  AL: "America/Chicago",
  ALABAMA: "America/Chicago",
  AR: "America/Chicago",
  ARKANSAS: "America/Chicago",
  IA: "America/Chicago",
  IOWA: "America/Chicago",
  IL: "America/Chicago",
  ILLINOIS: "America/Chicago",
  LA: "America/Chicago",
  LOUISIANA: "America/Chicago",
  MN: "America/Chicago",
  MINNESOTA: "America/Chicago",
  MO: "America/Chicago",
  MISSOURI: "America/Chicago",
  MS: "America/Chicago",
  MISSISSIPPI: "America/Chicago",
  OK: "America/Chicago",
  OKLAHOMA: "America/Chicago",
  WI: "America/Chicago",
  WISCONSIN: "America/Chicago",
  CO: "America/Denver",
  COLORADO: "America/Denver",
  MT: "America/Denver",
  MONTANA: "America/Denver",
  NM: "America/Denver",
  "NEW MEXICO": "America/Denver",
  UT: "America/Denver",
  UTAH: "America/Denver",
  WY: "America/Denver",
  WYOMING: "America/Denver",
  CA: "America/Los_Angeles",
  CALIFORNIA: "America/Los_Angeles",
  WA: "America/Los_Angeles",
  WASHINGTON: "America/Los_Angeles",
  HI: "Pacific/Honolulu",
  HAWAII: "Pacific/Honolulu",
};
export function leadZone(lead: Pick<Lead, "country"> & { time_zone?: string }) {
  if (lead.time_zone && ZONES.some(([z]) => z === lead.time_zone))
    return lead.time_zone;
  const normalized = lead.country
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim();
  const state = normalized.replace(
    /^(?:UNITED STATES OF AMERICA|UNITED STATES|U S A|U S|USA|US) /,
    "",
  );
  return state !== normalized ? STATE_ZONES[state] || "" : "";
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
