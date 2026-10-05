/**
 * Verifies the configured AI provider end-to-end through the app's own gateway,
 * not by calling Groq directly. Confirms env -> aiGateway -> provider.
 *
 * Run: npx tsx scripts/verify-ai.ts
 */
import "dotenv/config";
import { aiConfigInfo, aiComplete, aiProvider } from "../src/services/aiGateway";

async function main(): Promise<void> {
  const info = aiConfigInfo();
  console.log("provider:", aiProvider());
  console.log("baseUrl :", info.baseUrl ?? "(none)");
  console.log("model   :", info.model ?? "(none)");

  if (aiProvider() === "none") {
    console.error("\nFAIL: provider resolves to 'none'. Required:", info.requiredEnv.join(", "));
    process.exitCode = 1;
    return;
  }

  try {
    const out = await aiComplete(
      "verify-script",
      "You are a connectivity probe. Reply with the single word READY and nothing else.",
      "ping",
      { maxTokens: 16, temperature: 0 }
    );
    console.log("\ncompletion OK");
    console.log("model used :", out.model);
    console.log("cached     :", out.cached);
    console.log("reply      :", JSON.stringify(out.text));
    if (!out.text) {
      console.error("\nFAIL: empty completion.");
      process.exitCode = 1;
    }
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    console.error("\nFAIL:", err.code ?? "ERROR", "-", err.message);
    process.exitCode = 1;
  }
}

main();