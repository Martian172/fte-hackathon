import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson, handleRouteError, readKeys } from "@/lib/api";
import { chatWithFallback, DEFAULT_MODEL } from "@/lib/openrouter";
import { CHAT_SYSTEM } from "@/lib/prompts";

/**
 * Follow-up Q&A about the researched company (ChatGPT-style conversation).
 * The full research report is injected as context — no external calls needed.
 */

export const maxDuration = 60;

const Body = z.object({
  question: z.string().trim().min(1).max(2000),
  context: z.string().max(30_000),
  model: z.string().trim().min(1).max(120).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errorJson("Invalid chat request.", 400);
    const { question, context, model, history = [] } = parsed.data;

    const { openrouterKey } = readKeys(req);
    if (!openrouterKey) {
      return errorJson("OpenRouter API key missing — add it in the sidebar settings.", 401);
    }

    const { content, modelUsed } = await chatWithFallback(
      [
        { role: "system", content: `${CHAT_SYSTEM}\n\n=== RESEARCH CONTEXT ===\n${context}` },
        ...history,
        { role: "user", content: question },
      ],
      { apiKey: openrouterKey, model: model || DEFAULT_MODEL, temperature: 0.4, maxTokens: 900 }
    );

    return NextResponse.json({ answer: content, modelUsed });
  } catch (err) {
    return handleRouteError(err, "Chat failed — please try again.");
  }
}
