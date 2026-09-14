import { prisma } from "./prisma.js";

/**
 * Who a one-off announcement has already reached.
 *
 * Broadcast scripts had no memory at all: a second run of the same announcement would have gone
 * out to everyone who had already read it, with nothing in the code to stop it, and neither a
 * delivered WhatsApp message nor a delivered email can be recalled. The record lives in
 * SystemSetting rather than on Business because it is a property of the announcement, not of the
 * customer — a business that leaves and returns should not inherit a decision made about a message
 * it never saw.
 *
 * Addresses are whatever identifies a recipient on that channel: a normalised phone for WhatsApp,
 * a lowercased email for mail. They are only ever compared to each other, never parsed.
 */
export interface AnnounceRecord {
  key: string;
  sent: string[];
}

function keyFor(channel: string, announcement: string): string {
  return `announce:${channel}:${announcement}:sent`;
}

/**
 * Reads the record, treating anything unreadable as empty.
 *
 * Erring toward "nobody has had it" rather than "everybody has" is deliberate: a corrupt row that
 * read as everybody would make a run silently reach no one and report "0 sent", which looks like
 * success. The opposite mistake is visible the moment someone gets a second copy, and only after a
 * human decided to send.
 */
export async function loadAnnounceRecord(channel: string, announcement: string): Promise<AnnounceRecord> {
  const key = keyFor(channel, announcement);
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  if (!row) return { key, sent: [] };
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return { key, sent: parsed.filter((v): v is string => typeof v === "string") };
  } catch {
    console.warn(`[announce] ${key} is not readable — treating it as empty.`);
    return { key, sent: [] };
  }
}

/**
 * Adds addresses to the record.
 *
 * Callers write after each individual send rather than once at the end, so a run that dies halfway
 * cannot leave the people it already reached unmarked — that is the case where the next run
 * messages them a second time, and it is the one worth paying an extra write per send for.
 */
export async function markAnnounceSent(record: AnnounceRecord, addresses: string[]): Promise<void> {
  for (const a of addresses) if (!record.sent.includes(a)) record.sent.push(a);
  const value = JSON.stringify(record.sent);
  await prisma.systemSetting.upsert({
    where: { key: record.key },
    create: { key: record.key, value },
    update: { value },
  });
}
