import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_PROJECT_NAME = 'Default';
const DEFAULT_ORG_NAME = 'Tacit Demo';

let cachedProjectId: string | null = process.env.DEFAULT_PROJECT_ID?.trim() || null;

export async function getDefaultProjectId(supabaseClient: SupabaseClient): Promise<string | null> {
  if (cachedProjectId) return cachedProjectId;

  const { data, error } = await supabaseClient
    .from('projects')
    .select('id')
    .eq('name', DEFAULT_PROJECT_NAME)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (data?.id) {
    cachedProjectId = data.id;
    return data.id;
  }

  return null;
}

export async function getDefaultProjectWithOrg(
  supabaseClient: SupabaseClient,
): Promise<{ projectId: string; orgId: string } | null> {
  const projectId = await getDefaultProjectId(supabaseClient);
  if (!projectId) return null;

  const { data, error } = await supabaseClient
    .from('projects')
    .select('id, org_id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id || !data.org_id) return null;

  return { projectId: data.id, orgId: data.org_id };
}

export async function ensureDefaultMembership(
  supabaseClient: SupabaseClient,
  userId: string,
): Promise<void> {
  const projectId = await getDefaultProjectId(supabaseClient);
  if (!projectId) return;

  const { error } = await supabaseClient.from('project_members').upsert(
    {
      project_id: projectId,
      user_id: userId,
      role: 'member',
    },
    { onConflict: 'project_id,user_id', ignoreDuplicates: true },
  );

  if (error) {
    console.warn('ensureDefaultMembership failed:', error.message);
  }
}

export async function resolveProjectId(
  supabaseClient: SupabaseClient,
  projectId?: string | null,
): Promise<string | null> {
  if (projectId) return projectId;
  return getDefaultProjectId(supabaseClient);
}

export { DEFAULT_ORG_NAME, DEFAULT_PROJECT_NAME };
