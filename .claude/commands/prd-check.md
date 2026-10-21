---
description: Check a proposed feature or the current diff against PRD.md before building or merging it
argument-hint: "[feature description | PR number | empty for current diff]"
---

Check whether this work fits the EdgeCMS product direction in `PRD.md`.

Target: $ARGUMENTS

If the target is empty, use the current branch diff against `main` (`git diff main...HEAD` plus uncommitted changes). If it is a PR number, read it with `gh pr view <n> --json title,body,files` and `gh pr diff <n>`. Otherwise treat it as a feature description that has not been built yet.

## Steps

1. Read `PRD.md` in full, plus any other `*PRD.md` at the repo root (a downstream repo's own PRD, such as `SAAS-PRD.md`). Do not rely on memory of them. Downstream IDs extend `PRD.md` and never override its principles.
2. State the change in one sentence: the user-visible behavior or invariant it adds or changes.
3. Map it to requirement IDs (`CM-*`, `CMD-*`, `OF-*`, `AI-*`, `MD-*`, `DL-*`, `PL-*`, `EX-*`, `HS-*`, `OP-*`). Quote the requirement text you rely on.
4. Check every principle `P1`–`P10`. For each one the change touches, say how it holds, citing files or routes when there is a diff. Pay most attention to P2 tenant isolation, P3 command-only writes, P4 AI preview/approve and P5 published-only public reads.
5. Check the non-goals `NG1`–`NG8`. Any overlap is a conflict.
6. Check the repo boundary (§1.2): hosted-only work (billing, signup, plan limits, real deploy targets, website) belongs in `skyvis-my/edgecms-saas`, not the public framework. In the SaaS repo, generic framework changes belong upstream as `HS-*` or other `PRD.md` IDs.
7. Give one verdict:
   - **Aligned**: fits existing IDs and breaks no principle. Give the `PRD:` line for the PR description.
   - **Aligned, PRD update needed**: fits the direction but finishes a `Partial`/`Planned` item or needs a new ID. Write the exact `PRD.md` edit (status change or new row) to include in the same PR.
   - **Conflicts**: breaks a principle, hits a non-goal, or belongs in the SaaS repo. Name the rule, explain in two lines, and suggest the smallest change that would align. Do not implement it; this decision goes to the maintainers.
   - **No product change**: chore, test, CI or refactor. Give `PRD: n/a`.

## Output

```
Verdict: <one of the four>
PRD: <IDs or n/a>
Change: <one sentence>
Principles touched: <P# – holds/breaks, with evidence>
Non-goals: <none | NG# conflict>
PRD edits: <none | exact rows to change or add>
Next step: <one line>
```

Keep it short. Do not edit `PRD.md` unless the user asks or the verdict is "Aligned, PRD update needed" and you are already implementing the feature in this branch. Never change principles, goals or non-goals without explicit maintainer approval.
