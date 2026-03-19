type TacitMeetingMeta = {
  meeting_type: "phone" | "web";
  meeting_url?: string;
  recall_bot_id?: string;
  recall_recording_id?: string;
  created_at?: string;
};

const META_OPEN = "[tacit-meta]";
const META_CLOSE = "[/tacit-meta]";

export function embedTacitMetaIntoAgenda(agenda: string | null | undefined, meta: TacitMeetingMeta): string {
  const base = String(agenda || "").trim();
  const stripped = stripTacitMetaFromAgenda(base).trim();
  const payload = JSON.stringify(
    {
      ...meta,
      created_at: meta.created_at || new Date().toISOString(),
    },
    null,
    0,
  );

  const block = `${META_OPEN}${payload}${META_CLOSE}`;
  if (!stripped) return block;
  return `${stripped}\n\n---\n${block}`;
}

export function stripTacitMetaFromAgenda(agenda: string): string {
  const text = String(agenda || "");
  const start = text.indexOf(META_OPEN);
  const end = text.indexOf(META_CLOSE);
  if (start === -1 || end === -1 || end < start) return text;
  return (text.slice(0, start) + text.slice(end + META_CLOSE.length)).trim();
}

export function extractTacitMetaFromAgenda(agenda: string | null | undefined): TacitMeetingMeta | null {
  const text = String(agenda || "");
  const start = text.indexOf(META_OPEN);
  const end = text.indexOf(META_CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  const jsonText = text.slice(start + META_OPEN.length, end).trim();
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as TacitMeetingMeta;
  } catch {
    return null;
  }
}

