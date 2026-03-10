import { Request, Response, NextFunction } from 'express';
import { supabaseAnon, createAuthenticatedClient } from '../services/supabase.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  supabaseClient?: any;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    
    // Verify JWT with Supabase
    const { data: { user }, error } = await supabaseAnon.auth.getUser(token);

    if (error || !user) {
      console.error('❌ Auth verification failed:', error);
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    req.userId = user.id;
    // Create authenticated client with JWT token for RLS
    req.supabaseClient = createAuthenticatedClient(token);
    console.log('✅ Authenticated user:', user.id, user.email);
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}
