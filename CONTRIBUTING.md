# Contribution workflow

## Small, reviewable commits

Every commit must represent one coherent, independently reviewable change. Do not combine unrelated documentation, configuration, refactoring, generated files, or feature work in the same commit.

- Stage only files required for that change.
- Prefer several small commits over one broad commit.
- Run the smallest relevant validation before committing.
- Do not amend or rewrite published history unless explicitly requested.

## Commit messages

Use a concise Conventional Commit-style message:

```text
<type>(<optional scope>): <imperative summary>
```

Examples:

```text
docs(database): define journal posting invariants
feat(platform): add company and branch schema
feat(pos): persist local sale outbox event
test(accounting): cover duplicate sync posting
chore(ci): add typecheck workflow
fix(sync): preserve rejected event details
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`, `ci`.
