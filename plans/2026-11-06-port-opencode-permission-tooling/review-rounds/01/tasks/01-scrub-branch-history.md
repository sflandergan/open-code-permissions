# Task 01: Scrub the local source path and remote from branch history

**Objective:** Rewrite the commits of `feature/port-bikes-local-permission-items` after `main` so no commit tree or message contains the owner's local checkout path or the source repository's GitHub remote, then publish with a lease.

**Resolves:** R06, U2 (finding F2).

**Why:** Commit `d3cf63f` ("docs: plan the port of the OpenCode permission tooling") added plan lines naming the owner's local absolute checkout path of the source repository and that repository's GitHub remote URL. A later commit removed them from the files, but the pushed history still contains them. The owner asked that no remote trace remain. This task file deliberately does not spell out either string; discover them in Step 2.

**Owner gate:** This task rewrites published history and force-pushes. The controller must obtain explicit owner go-ahead immediately before Step 4. Without it, stop after Step 3 and report BLOCKED. Implementation workers never force-push on their own.

**Files:** none edited directly; plan files under `plans/2026-11-06-port-opencode-permission-tooling/` are rewritten in every commit of `main..HEAD`.

## Steps

- [ ] **Step 1: Record the starting point**

```bash
git status --short                                   # expected: empty
OLD_HEAD=$(git rev-parse HEAD); echo "$OLD_HEAD"
git branch backup/pre-scrub-review-01 HEAD           # local safety ref; never push it
```

- [ ] **Step 2: Discover the exact strings**

```bash
git show d3cf63f | grep '^+' | grep -oE '/Users/[^ `"]+|https://github\.com/[^ `")]+' | sort -u
```

Expected: one absolute local checkout path and one GitHub remote URL of the source repository (not `sflandergan/open-code-permissions`). Store them in shell variables `LOCAL_PATH` and `REMOTE_URL` (also cover the variant without `.git`). Do not write them to any tracked file, commit message, or report.

Also check commit messages: `git log --format=%B main..HEAD | grep -cF "$LOCAL_PATH"` and the same for `REMOTE_URL` (expected: 0; if not, add an equivalent `--msg-filter` in Step 3).

- [ ] **Step 3: Rewrite the trees**

```bash
export LOCAL_PATH REMOTE_URL
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --tree-filter '
  if [ -d plans ]; then
    grep -rlF -e "$LOCAL_PATH" -e "${REMOTE_URL%.git}" plans 2>/dev/null | while read -r f; do
      LOCAL_PATH="$LOCAL_PATH" REMOTE_URL="${REMOTE_URL%.git}" perl -pi -e "
        s/\Q\$ENV{REMOTE_URL}\E(\.git)?/<source repository remote provided by the user>/g;
        s/\Q\$ENV{LOCAL_PATH}\E/<SOURCE_ROOT provided by the user>/g;
      " "$f"
    done
  fi
' main..HEAD
```

Verify:

```bash
git log -p main..HEAD | grep -cF "$LOCAL_PATH"          # expected: 0
git log -p main..HEAD | grep -cF "${REMOTE_URL%.git}"   # expected: 0
git diff "$OLD_HEAD" HEAD --stat                        # expected: empty
```

The final tree must equal `OLD_HEAD` because the strings were already gone at the tip. If the diff is not empty or a grep is not 0, run `git reset --hard backup/pre-scrub-review-01` and report BLOCKED.

Remove the filter-branch backup ref: `git update-ref -d refs/original/refs/heads/feature/port-bikes-local-permission-items`.

- [ ] **Step 4: Publish (owner gate)**

After explicit owner go-ahead, use the `git-publish` skill to force-update the PR head branch with a lease against the previously pushed head. Do not call `git push` directly.

- [ ] **Step 5: Report**

Report OLD_HEAD, the new HEAD, the three verification outputs (counts and empty stat, never the strings themselves) and the publish result. Keep `backup/pre-scrub-review-01` locally until the owner confirms; do not delete branches (`AGENTS.md`).

This task creates no commit.
