import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

type GmailMessage = import("googleapis").gmail_v1.Schema$Message;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

const GOOGLE_CALENDAR_ICAL_URLS = process.env.GOOGLE_CALENDAR_ICAL_URLS;

async function createGmailClient() {
  if (!GMAIL_USER || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error("Missing Gmail environment variables (GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN).");
  }

  const oauth2Client = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    refresh_token: GMAIL_REFRESH_TOKEN,
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function listMessages(gmail: Awaited<ReturnType<typeof createGmailClient>>, query: string) {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
  });

  return res.data.messages ?? [];
}

async function fetchMessageDetails(
  gmail: Awaited<ReturnType<typeof createGmailClient>>,
  messages: GmailMessage[],
) {
  const detailed = await Promise.all(
    messages.map(async (m) => {
      if (!m.id) return null;
      const res = await gmail.users.messages.get({
        userId: "me",
        id: m.id,
        format: "full",
      });
      return res.data;
    }),
  );

  return detailed.filter(Boolean);
}

function filterBySenders(messages: GmailMessage[], senders: string[]) {
  const senderSet = new Set(senders.map((s) => s.toLowerCase()));

  return messages.filter((msg) => {
    const headers = msg.payload?.headers ?? [];
    const fromHeader = headers.find((h) => h.name?.toLowerCase() === "from");
    const fromValue = fromHeader?.value?.toLowerCase() ?? "";
    for (const sender of senderSet) {
      if (fromValue.includes(sender)) {
        return true;
      }
    }
    return false;
  });
}

async function fetchGmailStreams() {
  const gmail = await createGmailClient();

  const importantQuery =
    "label:IMPORTANT newer_than:12h -category:promotions -category:social (to:me)";
  const importantIds = await listMessages(gmail, importantQuery);
  const importantDetails = await fetchMessageDetails(gmail, importantIds);

  const newsletterQuery =
    "newer_than:24h from:(\"Morning Brew\" OR \"TLDR AI\" OR \"This Week in Fintech\" OR \"TLDR\")";
  const newsletterIds = await listMessages(gmail, newsletterQuery);
  const newsletterDetails = await fetchMessageDetails(gmail, newsletterIds);

  const marketQuery =
    "newer_than:24h from:(\"Marketwatch\" OR \"Barrons Follow Alert\" OR \"IBD Market Watch\")";
  const marketIds = await listMessages(gmail, marketQuery);
  const marketDetails = await fetchMessageDetails(gmail, marketIds);

  return {
    important: importantDetails,
    newsletters: filterBySenders(newsletterDetails, [
      "Morning Brew",
      "TLDR AI",
      "This Week in Fintech",
      "TLDR",
    ]),
    marketIntel: filterBySenders(marketDetails, [
      "Marketwatch",
      "Barrons Follow Alert",
      "IBD Market Watch",
    ]),
  };
}

async function fetchCalendarIcal() {
  if (!GOOGLE_CALENDAR_ICAL_URLS) {
    throw new Error("Missing GOOGLE_CALENDAR_ICAL_URLS environment variable.");
  }

  const urls = GOOGLE_CALENDAR_ICAL_URLS.split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    throw new Error("GOOGLE_CALENDAR_ICAL_URLS is set but contains no URLs.");
  }

  const responses = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to fetch calendar iCal from ${url}: ${res.status} ${res.statusText}`);
      }
      const text = await res.text();
      return { url, ical: text };
    }),
  );

  return responses;
}

async function fetchSportsRss() {
  const chelseaUrl =
    "https://news.google.com/rss/search?q=Chelsea+FC&hl=en-US&gl=US&ceid=US:en";
  const eaglesUrl =
    "https://news.google.com/rss/search?q=Philadelphia+Eagles&hl=en-US&gl=US&ceid=US:en";

  const [chelseaRes, eaglesRes] = await Promise.all([fetch(chelseaUrl), fetch(eaglesUrl)]);

  if (!chelseaRes.ok) {
    throw new Error(`Failed to fetch Chelsea FC news RSS: ${chelseaRes.status} ${chelseaRes.statusText}`);
  }
  if (!eaglesRes.ok) {
    throw new Error(`Failed to fetch Philadelphia Eagles news RSS: ${eaglesRes.status} ${eaglesRes.statusText}`);
  }

  const [chelseaRss, eaglesRss] = await Promise.all([
    chelseaRes.text(),
    eaglesRes.text(),
  ]);

  return {
    chelseaRss,
    eaglesRss,
  };
}

async function main() {
  const results: {
    gmail?: Awaited<ReturnType<typeof fetchGmailStreams>>;
    calendarIcal?: Awaited<ReturnType<typeof fetchCalendarIcal>>;
    sports?: Awaited<ReturnType<typeof fetchSportsRss>>;
    errors: string[];
    fetchedAt: string;
  } = {
    errors: [],
    fetchedAt: new Date().toISOString(),
  };

  try {
    results.gmail = await fetchGmailStreams();
  } catch (err) {
    results.errors.push(`gmail: ${(err as Error).message}`);
  }

  try {
    results.calendarIcal = await fetchCalendarIcal();
  } catch (err) {
    results.errors.push(`calendar: ${(err as Error).message}`);
  }

  try {
    results.sports = await fetchSportsRss();
  } catch (err) {
    results.errors.push(`sports: ${(err as Error).message}`);
  }

  const outputPath = path.join(
    __dirname,
    "..",
    "apps",
    "good-morning",
    "data",
    "raw_dump.json",
  );

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Morning data written to ${outputPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error in fetch_morning_data:", err);
  process.exitCode = 1;
});

