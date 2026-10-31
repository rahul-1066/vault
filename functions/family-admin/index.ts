import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createAdminHandler } from './handler.mjs';

Deno.serve(createAdminHandler({
  createClient,
  projectUrl: Deno.env.get('SUPABASE_URL') ?? '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  // Replace only with the approved, exact production origin during setup.
  allowedOrigin: Deno.env.get('VAULT_SITE_ORIGIN') ?? '__VAULT_ORIGIN__',
}));
