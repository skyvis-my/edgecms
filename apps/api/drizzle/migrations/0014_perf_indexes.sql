CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user" ("email");
CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "tenant_users_user_id_idx" ON "tenant_users" ("userId");
CREATE INDEX IF NOT EXISTS "change_log_tenant_scope_idx" ON "change_log" ("tenantScope");
CREATE INDEX IF NOT EXISTS "change_log_tenant_scope_sequence_idx" ON "change_log" ("tenantScope","sequence");
CREATE INDEX IF NOT EXISTS "webhooks_enabled_events_idx" ON "webhooks" ("enabled","events");
