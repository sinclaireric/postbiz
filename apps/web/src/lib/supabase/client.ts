'use client';

import { createBrowserClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from './env';

export const createClient = () => createBrowserClient(supabaseUrl, supabaseAnonKey);
