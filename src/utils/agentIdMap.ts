const AGENT_ENTRIES: Array<{ id: string; names: string[] }> = [
  { id: 'sage', names: ['sage'] },
  { id: 'aria', names: ['aria'] },
  { id: 'mason', names: ['mason'] },
  { id: 'lexa', names: ['lexa', 'clara'] },
  { id: 'manu', names: ['manu'] },
  { id: 'eagle', names: ['eagle'] },
  { id: 'rachael', names: ['rachael', 'rachel'] },
  { id: 'ross', names: ['ross'] },
  { id: 'monica', names: ['monica'] },
  { id: 'chandler', names: ['chandler'] },
];

const NAME_TO_ID = new Map<string, string>();
for (const entry of AGENT_ENTRIES) {
  NAME_TO_ID.set(entry.id, entry.id);
  for (const name of entry.names) {
    NAME_TO_ID.set(name.toLowerCase(), entry.id);
  }
}

export function resolveAgentId(agentName: string | null | undefined): string {
  if (!agentName?.trim()) return 'unknown';
  const normalized = agentName.trim().toLowerCase();
  const direct = NAME_TO_ID.get(normalized);
  if (direct) return direct;
  const slug = normalized.replace(/[^a-z0-9]+/g, '');
  return NAME_TO_ID.get(slug) ?? (slug || 'unknown');
}
