How to create a git-format patch (locally)

If you want a patch file containing the changes in this working copy, run these commands locally in your git clone:

# 1. Create a commit on a branch
git checkout -b chore/prepare-ci-docs
git add .
git commit -m "chore: prepare CI, docs, twilio dry-run, tests, docker"

# 2. Create a patch for that commit
# This will create a file like 0001-chore-prepare-ci-docs.patch
git format-patch -1 HEAD --stdout > ../destapespr-unified-bot-bilingual-changes.patch

# 3. Share the patch file or apply it in another repo
# To apply the patch in another clone:
# git am < destapespr-unified-bot-bilingual-changes.patch

Notes
- Do NOT include your .env file or any secrets in commits. Use the `.env.example` and GitHub Secrets for CI.
- If you need me to generate a plain unified diff of specific files, tell me which files and I will produce it.
