import type { Member } from "./types";
export function can(
  m: Member,
  cap: "sales" | "export" | "archive" | "ai" | "shared_sms",
) {
  return (
    m.active &&
    (m.role === "Admin" ||
      (cap === "sales"
        ? m.job_role === "Sales rep"
        : cap === "shared_sms"
          ? m.job_role === "Sales rep" && !!m.can_shared_sms
          : !!m[("can_" + cap) as "can_export" | "can_archive" | "can_ai"]))
  );
}
