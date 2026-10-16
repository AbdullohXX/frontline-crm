import type { Member } from "@/lib/types";
const colors = [
  "#6750a4",
  "#176b87",
  "#a34052",
  "#367548",
  "#8e570c",
  "#7b4b8e",
  "#236f75",
];
export function Avatar({
  member,
  name,
  email,
}: {
  member?: Member;
  name?: string;
  email?: string;
}) {
  const label = member?.display_name || name || email || "?";
  let hash = 0;
  for (const c of member?.email || email || label)
    hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className="member-avatar"
      style={{
        background: member?.avatar_color || colors[hash % colors.length],
      }}
      title={label}
    >
      {member?.avatar_image ? (
        <img src={member.avatar_image} alt={label} />
      ) : (
        label.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
export default function MemberIdentity({
  member,
  email,
  name,
}: {
  member?: Member;
  email?: string | null;
  name?: string;
}) {
  return (
    <span className="member-identity">
      <Avatar member={member} email={email || undefined} name={name} />
      <span>{member?.display_name || name || email || "Not assigned"}</span>
    </span>
  );
}
