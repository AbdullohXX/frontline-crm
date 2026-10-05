// Deliberately fail closed until Getyn documents its signature contract.
export async function POST() {
  return Response.json(
    { error: "Getyn webhook integration is not configured." },
    { status: 503 },
  );
}
