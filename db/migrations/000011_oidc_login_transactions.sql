-- Short-lived server-side state for an OIDC Authorization Code + PKCE redirect.
-- The state value is stored only as a SHA-256 digest. The nonce and PKCE
-- verifier are encrypted by the API before being persisted.

CREATE TABLE platform.oidc_login_transaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_digest bytea NOT NULL UNIQUE
    CONSTRAINT oidc_login_transaction_state_digest_length_valid
    CHECK (octet_length(state_digest) = 32),
  code_verifier_ciphertext bytea NOT NULL
    CONSTRAINT oidc_login_transaction_verifier_ciphertext_valid
    CHECK (octet_length(code_verifier_ciphertext) > 28),
  nonce_ciphertext bytea NOT NULL
    CONSTRAINT oidc_login_transaction_nonce_ciphertext_valid
    CHECK (octet_length(nonce_ciphertext) > 28),
  return_to text NOT NULL DEFAULT '/'
    CONSTRAINT oidc_login_transaction_return_to_valid
    CHECK (
      return_to = '/'
      OR (return_to LIKE '/%' AND return_to NOT LIKE '//%')
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT oidc_login_transaction_expiry_valid
    CHECK (expires_at > created_at)
);

CREATE INDEX oidc_login_transaction_expiry_idx
  ON platform.oidc_login_transaction (expires_at)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION platform.reject_oidc_login_transaction_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'consumed OIDC login transaction % is immutable', OLD.id;
  END IF;

  IF NEW.state_digest <> OLD.state_digest
    OR NEW.code_verifier_ciphertext <> OLD.code_verifier_ciphertext
    OR NEW.nonce_ciphertext <> OLD.nonce_ciphertext
    OR NEW.return_to <> OLD.return_to
    OR NEW.created_at <> OLD.created_at
    OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'OIDC login transaction % fields are immutable', OLD.id;
  END IF;

  IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'OIDC login transaction % may only be consumed', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER oidc_login_transaction_immutable
  BEFORE UPDATE ON platform.oidc_login_transaction
  FOR EACH ROW EXECUTE FUNCTION platform.reject_oidc_login_transaction_change();

GRANT SELECT, INSERT, UPDATE ON platform.oidc_login_transaction TO ledgerlite_app;

COMMENT ON TABLE platform.oidc_login_transaction IS
  'One-time expiring OIDC authorization transactions; PKCE verifier and nonce are encrypted.';
