-- Server-managed browser sessions are global identity records rather than
-- tenant-owned data. The browser receives only a high-entropy opaque token;
-- this table retains its SHA-256 digest, never the raw token.

CREATE TABLE platform.browser_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES platform.app_user(id) ON DELETE RESTRICT,
  token_digest bytea NOT NULL UNIQUE
    CONSTRAINT browser_session_token_digest_length_valid
    CHECK (octet_length(token_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  invalidated_reason text,
  CONSTRAINT browser_session_idle_after_created_at_valid
    CHECK (idle_expires_at > created_at),
  CONSTRAINT browser_session_idle_after_last_seen_valid
    CHECK (idle_expires_at > last_seen_at),
  CONSTRAINT browser_session_absolute_after_created_at_valid
    CHECK (absolute_expires_at > created_at),
  CONSTRAINT browser_session_idle_before_absolute_valid
    CHECK (idle_expires_at <= absolute_expires_at),
  CONSTRAINT browser_session_invalidation_valid CHECK (
    (invalidated_at IS NULL AND invalidated_reason IS NULL)
    OR (invalidated_at IS NOT NULL AND length(btrim(invalidated_reason)) > 0)
  )
);

CREATE INDEX browser_session_active_user_idx
  ON platform.browser_session (user_id, absolute_expires_at)
  WHERE invalidated_at IS NULL;

CREATE OR REPLACE FUNCTION platform.reject_browser_session_reactivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.token_digest <> OLD.token_digest THEN
    RAISE EXCEPTION 'browser session % identity is immutable', OLD.id;
  END IF;

  IF NEW.absolute_expires_at <> OLD.absolute_expires_at THEN
    RAISE EXCEPTION 'browser session % absolute expiry is immutable', OLD.id;
  END IF;

  IF OLD.invalidated_at IS NOT NULL AND NEW.invalidated_at IS NULL THEN
    RAISE EXCEPTION 'invalidated browser session % cannot be reactivated', OLD.id;
  END IF;

  IF OLD.invalidated_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'invalidated browser session % is immutable', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER browser_session_no_reactivation
  BEFORE UPDATE ON platform.browser_session
  FOR EACH ROW EXECUTE FUNCTION platform.reject_browser_session_reactivation();

GRANT SELECT, INSERT, UPDATE ON platform.browser_session TO ledgerlite_app;

COMMENT ON TABLE platform.browser_session IS
  'Revocable server-side browser sessions; stores only SHA-256 token digests.';
