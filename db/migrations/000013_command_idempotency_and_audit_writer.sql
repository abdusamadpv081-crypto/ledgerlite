-- Give online commands a tenant/actor-scoped retry anchor and a single
-- reviewed path for audited configuration changes.

CREATE TABLE platform.command_idempotency (
  company_id uuid NOT NULL REFERENCES platform.company(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  command text NOT NULL CHECK (length(btrim(command)) BETWEEN 1 AND 120),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  correlation_id uuid NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (company_id, actor_user_id, command, idempotency_key),
  CHECK (
    (response IS NULL AND completed_at IS NULL)
    OR (response IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (response IS NULL OR jsonb_typeof(response) = 'object')
);

ALTER TABLE platform.command_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.command_idempotency FORCE ROW LEVEL SECURITY;

CREATE POLICY command_idempotency_actor_isolation
  ON platform.command_idempotency
  USING (
    company_id = platform.current_company_id()
    AND actor_user_id = platform.current_actor_id()
  )
  WITH CHECK (
    company_id = platform.current_company_id()
    AND actor_user_id = platform.current_actor_id()
  );

GRANT SELECT, INSERT, UPDATE ON platform.command_idempotency TO ledgerlite_app;

CREATE OR REPLACE FUNCTION platform.acquire_command_idempotency(
  p_command text,
  p_idempotency_key text,
  p_request_hash bytea,
  p_correlation_id uuid
)
RETURNS TABLE (
  is_new boolean,
  response jsonb,
  correlation_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_company_id uuid := platform.current_company_id();
  v_actor_user_id uuid := platform.current_actor_id();
  v_request_hash bytea;
  v_response jsonb;
  v_correlation_id uuid;
BEGIN
  IF v_company_id IS NULL OR v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'command idempotency requires tenant and actor context';
  END IF;

  INSERT INTO platform.command_idempotency (
    company_id,
    actor_user_id,
    command,
    idempotency_key,
    request_hash,
    correlation_id
  )
  VALUES (
    v_company_id,
    v_actor_user_id,
    p_command,
    p_idempotency_key,
    p_request_hash,
    p_correlation_id
  )
  ON CONFLICT DO NOTHING;

  SELECT request_hash, response, correlation_id
    INTO v_request_hash, v_response, v_correlation_id
    FROM platform.command_idempotency
   WHERE company_id = v_company_id
     AND actor_user_id = v_actor_user_id
     AND command = p_command
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF v_request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'idempotency key was already used for a different request'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT v_response IS NULL, v_response, v_correlation_id;
END;
$$;

CREATE OR REPLACE FUNCTION platform.complete_command_idempotency(
  p_command text,
  p_idempotency_key text,
  p_response jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_company_id uuid := platform.current_company_id();
  v_actor_user_id uuid := platform.current_actor_id();
BEGIN
  IF v_company_id IS NULL OR v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'command idempotency requires tenant and actor context';
  END IF;

  IF p_response IS NULL OR jsonb_typeof(p_response) <> 'object' THEN
    RAISE EXCEPTION 'command response must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  UPDATE platform.command_idempotency
     SET response = p_response,
         completed_at = now()
   WHERE company_id = v_company_id
     AND actor_user_id = v_actor_user_id
     AND command = p_command
     AND idempotency_key = p_idempotency_key
     AND response IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'idempotency record cannot be completed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION audit.write_event(
  p_company_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, platform, audit
AS $$
DECLARE
  v_actor_user_id uuid := platform.current_actor_id();
  v_event_id uuid;
  v_correlation_id uuid := NULLIF(
    current_setting('app.current_correlation_id', true),
    ''
  )::uuid;
BEGIN
  IF p_company_id IS DISTINCT FROM platform.current_company_id() THEN
    RAISE EXCEPTION 'audit event company does not match tenant context';
  END IF;

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'audit event requires actor context';
  END IF;

  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RAISE EXCEPTION 'audit metadata must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO audit.event (
    company_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    correlation_id,
    metadata
  )
  VALUES (
    p_company_id,
    v_actor_user_id,
    p_action,
    p_entity_type,
    p_entity_id,
    v_correlation_id,
    p_metadata
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION platform.acquire_command_idempotency(text, text, bytea, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.complete_command_idempotency(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit.write_event(uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.acquire_command_idempotency(text, text, bytea, uuid) TO ledgerlite_app;
GRANT EXECUTE ON FUNCTION platform.complete_command_idempotency(text, text, jsonb) TO ledgerlite_app;
GRANT EXECUTE ON FUNCTION audit.write_event(uuid, text, text, uuid, jsonb) TO ledgerlite_app;

COMMENT ON TABLE platform.command_idempotency IS
  'Tenant- and actor-scoped completed online command responses for safe retries.';
COMMENT ON FUNCTION audit.write_event(uuid, text, text, uuid, jsonb) IS
  'Appends an actor-bound tenant audit event under transaction-local context.';
