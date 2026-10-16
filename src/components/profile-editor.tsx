"use client";
import { useState } from "react";
import type { Member } from "@/lib/types";
import { Avatar } from "./member-identity";
export default function ProfileEditor({
  member,
  onSaved,
  demo,
}: {
  member: Member;
  onSaved: (m: Member) => void;
  demo: boolean;
}) {
  const [draft, setDraft] = useState(member),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function photo(file: File) {
    try {
      if (
        file.size > 8000000 ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
      )
        throw Error("Choose a JPG, PNG or WebP image under 8 MB");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 96;
      const ctx = canvas.getContext("2d")!;
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        96,
        96,
      );
      bitmap.close();
      const data = canvas.toDataURL("image/jpeg", 0.75);
      if (data.length > 30000) throw Error("Image could not be resized");
      setDraft({ ...draft, avatar_image: data });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avatar_color: draft.avatar_color || "",
          avatar_image: draft.avatar_image || "",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      onSaved(d.member);
      setError("Profile saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="profile-editor">
      <summary>
        <Avatar member={member} />
        <span className="sr-only">My profile</span>
      </summary>
      <Avatar member={draft} />
      <label>
        Avatar color
        <input
          type="color"
          value={draft.avatar_color || "#6750a4"}
          onChange={(e) => setDraft({ ...draft, avatar_color: e.target.value })}
        />
      </label>
      <label>
        Profile picture
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void photo(f);
          }}
        />
      </label>
      <button onClick={() => setDraft({ ...draft, avatar_image: "" })}>
        Use initials
      </button>
      <button disabled={busy || demo} onClick={() => void save()}>
        Save profile
      </button>
      {error && <p role="status">{error}</p>}
    </details>
  );
}
