import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-sonnet-4-6";

type GmailPayload = {
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
  mimeType?: string;
};

type GmailMessage = {
  id?: string;
  payload?: GmailPayload;
};

type RawDump = {
  gmail?: {
    important?: GmailMessage[];
    newsletters?: GmailMessage[];
    marketIntel?: GmailMessage[];
  };
  calendarIcal?: Array<{ url: string; ical: string }>;
  sports?: { chelseaRss?: string; eaglesRss?: string };
  errors?: string[];
  fetchedAt?: string;
};

function getHeader(msg: GmailMessage, name: string): string | undefined {
  const headers = msg.payload?.headers ?? [];
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value;
}

function decodeBody(data?: string): string {
  if (!data) return "";
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function extractTextFromPayload(payload: GmailPayload): string {
  if (payload.body?.data) {
    const decoded = decodeBody(payload.body.data);
    if (decoded.trim()) return decoded;
  }
  const parts = payload.parts ?? [];
  const textPart = parts.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) return decodeBody(textPart.body.data);
  const htmlPart = parts.find((p) => p.mimeType === "text/html");
  if (htmlPart?.body?.data) {
    const html = decodeBody(htmlPart.body.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return parts.map(extractTextFromPayload).filter(Boolean).join("\n\n");
}

function emailToSnippet(msg: GmailMessage, maxLen = 2000): string {
  const from = getHeader(msg, "from") ?? "";
  const subject = getHeader(msg, "subject") ?? "";
  const body = msg.payload ? extractTextFromPayload(msg.payload) : "";
  const snippet = body.slice(0, maxLen) + (body.length > maxLen ? "…" : "");
  return `From: ${from}\nSubject: ${subject}\n\n${snippet}`;
}

function icalToPlainSummary(calEntries: Array<{ url: string; ical: string }>): string {
  const lines: string[] = [];
  for (const { url, ical } of calEntries) {
    const events = ical.split(/\r?\n/).filter((l) => l.startsWith("SUMMARY:"));
    for (const e of events) {
      lines.push(e.replace(/^SUMMARY:/i, "").trim());
    }
  }
  return lines.length ? `Today's events: ${lines.join("; ")}` : "No events listed for today.";
}

function getClaudeText(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text ?? "" : "";
}

function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

async function main() {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY environment variable.");
  }

  const rawPath = path.join(__dirname, "..", "apps", "good-morning", "data", "raw_dump.json");
  const rawJson = await fs.readFile(rawPath, "utf8").catch((err) => {
    throw new Error(`Failed to read raw_dump.json: ${(err as Error).message}`);
  });

  const raw: RawDump = JSON.parse(rawJson);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const newsletterTexts: string[] = [];
  if (raw.gmail?.newsletters?.length) {
    for (const msg of raw.gmail.newsletters) {
      const from = getHeader(msg, "from");
      const subject = getHeader(msg, "subject");
      const body = emailToSnippet(msg, 4000);
      newsletterTexts.push(`--- Newsletter: ${from} | ${subject}\n${body}`);
    }
  }

  const importantSnippets: string[] = [];
  if (raw.gmail?.important?.length) {
    for (const msg of raw.gmail.important) {
      importantSnippets.push(emailToSnippet(msg, 1500));
    }
  }

  const calendarSummary = raw.calendarIcal?.length
    ? icalToPlainSummary(raw.calendarIcal)
    : "No calendar data.";

  const newsletterSummaries: Array<{ source: string; bullets: string[] }> = [];
  if (newsletterTexts.length > 0) {
    const prompt = `You are summarizing email newsletters for a morning briefing. For each newsletter below, output exactly 3 short, punchy bullet points (one line each). Format your response as JSON only: an array of objects with "source" (newsletter name/sender) and "bullets" (array of 3 strings). No other text.

Newsletters:
${newsletterTexts.join("\n\n---\n\n")}`;

    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const content = getClaudeText(res).trim();
    if (content) {
      try {
        const parsed = JSON.parse(extractJson(content));
        const arr = Array.isArray(parsed) ? parsed : parsed.summaries ?? parsed.newsletters ?? [];
        for (const item of arr) {
          newsletterSummaries.push({
            source: item.source ?? item.name ?? "Newsletter",
            bullets: Array.isArray(item.bullets) ? item.bullets : [],
          });
        }
      } catch {
        newsletterSummaries.push({ source: "Newsletters", bullets: [content.slice(0, 200)] });
      }
    }
  }

  const oneOnOneFlags: Array<{ from: string; subject: string; reason?: string }> = [];
  if (importantSnippets.length > 0) {
    const prompt = `You are reviewing important emails to identify which ones need a direct 1-on-1 reply from the user. List only emails that clearly need a personal response (e.g. direct question, request, or 1:1 thread). Output JSON only: an array of objects with "from", "subject", and optional "reason" (one short phrase). If none need a response, output [].

Emails:
${importantSnippets.join("\n\n---\n\n")}`;

    const res = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const content = getClaudeText(res).trim();
    if (content) {
      try {
        const parsed = JSON.parse(extractJson(content));
        const arr = Array.isArray(parsed) ? parsed : parsed.emails ?? parsed.flags ?? [];
        for (const item of arr) {
          oneOnOneFlags.push({
            from: item.from ?? "",
            subject: item.subject ?? "",
            reason: item.reason,
          });
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  const vibePrompt = `Using only this context, write exactly one short, motivating sentence for a "Morning Vibe Check" that summarizes what the day ahead looks like. Tone: professional but warm. Do not add quotes or labels—output only the single sentence.

- Calendar: ${calendarSummary}
- Important emails needing attention: ${oneOnOneFlags.length}
- Newsletters summarized: ${newsletterSummaries.length}`;

  const vibeRes = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: vibePrompt }],
  });

  const morningVibeCheck =
    getClaudeText(vibeRes).trim() ||
    "You're set for the day—tackle the priorities and keep the vibe up.";

  const output = {
    generatedAt: new Date().toISOString(),
    morningVibeCheck,
    newsletterSummaries,
    oneOnOneFlags,
    calendarSummary,
  };

  const outPath = path.join(__dirname, "..", "apps", "good-morning", "data", "good-morning.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Distilled morning briefing written to ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("distill error:", err);
  process.exitCode = 1;
});
