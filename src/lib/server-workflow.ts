import { ingestionDatabase } from "./quo-server";
export async function serverWorkflow(
  actor: string,
  operation: string,
  p: unknown,
) {
  if (!process.env.QUO_INGEST_TOKEN)
    throw Error("Server integration is not configured");
  const { data, error } = await ingestionDatabase().rpc("crm_server_action", {
    token: process.env.QUO_INGEST_TOKEN,
    actor_email: actor,
    operation,
    p,
  });
  if (error)
    throw Error(
      error.message.startsWith("RATE:")
        ? error.message
        : "Could not complete the server operation",
    );
  return data;
}
