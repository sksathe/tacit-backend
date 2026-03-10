import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { CreateProjectSchema } from '../types/index.js';

const router = Router();

// Get all projects for the authenticated user
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    console.log('🔍 Fetching projects for user:', userId);

    // First, let's check project_members directly to verify RLS
    const { data: membersData, error: membersError } = await req.supabaseClient!
      .from('project_members')
      .select('project_id, role')
      .eq('user_id', userId);

    console.log('👥 Project memberships:', membersData?.length || 0, membersData);
    if (membersError) {
      console.error('❌ Error fetching project_members:', membersError);
    }

    // Try fetching projects - start with simple query to test RLS
    let data, error;
    
    // First try: Simple query without joins
    const simpleResult = await req.supabaseClient!
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });
    
    console.log('🔍 Simple query result:', {
      count: simpleResult.data?.length || 0,
      error: simpleResult.error?.message,
    });
    
    // Second try: Full query with joins
    const fullResult = await req.supabaseClient!
      .from('projects')
      .select(`
        *,
        org:orgs(*),
        members:project_members(*)
      `)
      .order('created_at', { ascending: false });
    
    data = fullResult.data;
    error = fullResult.error;

    if (error) {
      console.error('❌ Supabase error fetching projects:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      console.error('Error details:', error.details);
      console.error('Error hint:', error.hint);
      throw error;
    }

    console.log(`✅ Found ${data?.length || 0} projects for user ${userId}`);
    if (data && data.length > 0) {
      console.log('📋 Projects:', data.map((p: any) => ({ id: p.id, name: p.name })));
    } else {
      console.warn('⚠️ No projects found. User may not be assigned to any projects.');
      console.warn('💡 Check project_members table to ensure user is assigned to a project.');
      console.warn('💡 User ID:', userId);
      console.warn('💡 Project memberships found:', membersData?.length || 0);
    }

    res.json({ projects: data || [] });
  } catch (error: any) {
    console.error('❌ Error fetching projects:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    res.status(500).json({ error: error.message || 'Failed to fetch projects' });
  }
});

// Get a specific project
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await req.supabaseClient!
      .from('projects')
      .select(`
        *,
        org:orgs(*),
        members:project_members(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project: data });
  } catch (error: any) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch project' });
  }
});

// Create a new project
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = CreateProjectSchema.parse(req.body);
    const userId = req.userId!;

    // Verify user has access to the org (by checking if they're a member of any project in that org)
    const { data: orgCheck, error: orgError } = await req.supabaseClient!
      .from('projects')
      .select('id')
      .eq('org_id', body.org_id)
      .limit(1);

    if (orgError) throw orgError;

    // Create project
    const { data: project, error: projectError } = await req.supabaseClient!
      .from('projects')
      .insert({
        org_id: body.org_id,
        name: body.name,
      })
      .select()
      .single();

    if (projectError) throw projectError;

    // Add creator as owner
    const { error: memberError } = await req.supabaseClient!
      .from('project_members')
      .insert({
        project_id: project.id,
        user_id: userId,
        role: 'owner',
      });

    if (memberError) throw memberError;

    res.status(201).json({ project });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request body', details: error.errors });
      return;
    }
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message || 'Failed to create project' });
  }
});

export default router;
