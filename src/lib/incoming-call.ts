export type IncomingCall = {
  id: string;
  phone: string;
  lead_id: string | null;
  status: string;
  occurred_at: string;
};

export function isLiveIncomingCall(call: IncomingCall, now = Date.now()) {
  const age = now - Date.parse(call.occurred_at);
  return (
    Number.isFinite(age) &&
    age >= -5000 &&
    age < 120000 &&
    ["ringing", "in-progress", "answered"].includes(call.status)
  );
}
