-- Create roles table for RBAC
CREATE TABLE roles (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_default integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX roles_tenant_id_idx ON roles(tenant_id);
CREATE INDEX roles_tenant_name_idx ON roles(tenant_id, name);

-- Create permissions table for RBAC
CREATE TABLE permissions (
  id text PRIMARY KEY,
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  subject text NOT NULL,
  action text NOT NULL,
  conditions text,
  created_at text NOT NULL
);
CREATE INDEX permissions_role_id_idx ON permissions(role_id);
