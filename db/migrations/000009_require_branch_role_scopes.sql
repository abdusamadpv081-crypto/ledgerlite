-- Company-wide roles must not be branch-scoped, and operational roles must
-- always name a branch. This keeps role data aligned with authorization scope.

ALTER TABLE platform.role_assignment
  DROP CONSTRAINT role_assignment_check1,
  ADD CONSTRAINT role_assignment_scope_valid CHECK (
    (role_template IN ('owner', 'accountant') AND branch_id IS NULL)
    OR (role_template IN ('branch_manager', 'cashier') AND branch_id IS NOT NULL)
  );
