# Family Vault — design draft

This is a draft for design review, not a deployed or security-validated product.
No personal documents, access tokens, passwords, or Supabase project keys are included.

The interface sketches family sign-in, a private document list, uploads, downloads,
and administrator-created accounts. `database/vault.sql` and
`functions/family-admin/index.ts` are draft backend components: they have not been
applied to a Supabase project or tested end to end.

Before any real deployment, finish setup in a dedicated project, configure Auth and
the administrator account, review the database policies and the admin function,
and verify that anonymous access and access across family accounts are denied.
Configure password-reset delivery if needed, and maintain separate backups of
documents. Only a Supabase project URL and publishable key may enter `config.js`;
never put service-role keys or credentials in the public GitHub repository.

The `vendor` directory contains the pinned Supabase JavaScript SDK and its license.

## Current state

The interface and backend are prepared but are not connected to a real project.
Local tests cover account isolation, the private storage policies, temporary
password changes and administrator account creation. These tests do not replace
verification against the actual hosted Supabase project.

Before publishing, create the dedicated Supabase project, apply the reviewed SQL,
set up the initial administrator securely, deploy the `family-admin` function to
Supabase with the final website origin, and add the project URL and publishable
key to `config.js`. Check that account creation, password changes, document
uploads and downloads, and cross-account restrictions work on the real services.
Only then should family members use real documents. Supabase's default email
service may not deliver password reset messages to all family accounts; configure
and test an appropriate email provider before relying on password recovery.
