import { NextResponse } from "next/server";
import { z } from "zod";
import { errorJson, handleRouteError } from "@/lib/api";
import { fetchWithTimeout } from "@/lib/http";

/**
 * Bonus — Discord integration.
 * After a report is generated the client POSTs the PDF (base64) here; we forward it to
 * the configured channel via the Discord Bot API as a multipart message with an embed.
 * The bot token comes from the settings UI (evaluator-provided) or DISCORD_BOT_TOKEN env.
 */

export const maxDuration = 60;

const MAX_PDF_BYTES = 8 * 1024 * 1024; // Discord's default upload limit

const Body = z.object({
  botToken: z.string().trim().optional(),
  channelId: z.string().trim().regex(/^\d{10,25}$/, "Channel ID must be numeric"),
  applicantName: z.string().trim().min(1).max(100),
  applicantEmail: z.string().trim().email().max(200),
  companyName: z.string().trim().min(1).max(200),
  companyWebsite: z.string().trim().max(300),
  fileName: z.string().trim().max(120).default("company-report.pdf"),
  pdfBase64: z.string().min(100),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error?.issues[0];
      return errorJson(`Invalid Discord request${issue ? ` — ${issue.path.join(".")}: ${issue.message}` : ""}.`, 400);
    }
    const b = parsed.data;

    const token = b.botToken || process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) return errorJson("Discord bot token missing — add it in the Discord settings tab.", 401);

    let pdf: Buffer;
    try {
      pdf = Buffer.from(b.pdfBase64, "base64");
    } catch {
      return errorJson("PDF payload could not be decoded.", 400);
    }
    if (pdf.byteLength < 100 || pdf.byteLength > MAX_PDF_BYTES) {
      return errorJson("PDF is empty or exceeds Discord's 8 MB upload limit.", 400);
    }

    const payload = {
      content: "📊 **New Company Research Report**",
      embeds: [
        {
          title: `Company Research: ${b.companyName}`,
          color: 0xf59e0b,
          fields: [
            { name: "👤 Applicant Name", value: b.applicantName, inline: true },
            { name: "📧 Applicant Email", value: b.applicantEmail, inline: true },
            { name: "🏢 Company Name", value: b.companyName, inline: true },
            { name: "🔗 Company Website", value: b.companyWebsite || "—", inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer: { text: "Company Research AI" },
        },
      ],
      attachments: [{ id: 0, filename: b.fileName }],
    };

    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    form.append("files[0]", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), b.fileName);

    const res = await fetchWithTimeout(
      `https://discord.com/api/v10/channels/${b.channelId}/messages`,
      { method: "POST", headers: { Authorization: `Bot ${token}` }, body: form },
      20_000
    );

    if (res.status === 401) return errorJson("Discord rejected the bot token — check it and try again.", 401);
    if (res.status === 403) return errorJson("The bot lacks access to that channel (invite it & grant Send Messages + Attach Files).", 403);
    if (res.status === 404) return errorJson("Discord channel not found — double-check the Channel ID.", 404);
    if (res.status === 429) return errorJson("Discord rate limit hit — try again in a few seconds.", 429);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Discord error", res.status, detail.slice(0, 300));
      return errorJson(`Discord API error (HTTP ${res.status}).`, 502);
    }

    const msg = (await res.json()) as { id?: string };
    return NextResponse.json({ ok: true, messageId: msg.id ?? null });
  } catch (err) {
    return handleRouteError(err, "Failed to send the report to Discord.");
  }
}
