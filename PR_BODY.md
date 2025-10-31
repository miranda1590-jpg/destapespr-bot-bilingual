#: PR - Improve Twilio safety, tests, and docs

Summary

- Adds safer Twilio wrapper with validation and clearer dry-run metadata.
- Adds a Jest test scaffold for the wrapper.
- Documents `ENABLE_TWILIO` dry-run behavior in `CONTRIBUTING.md`.

Why

These changes make local development and CI safer by preventing accidental outbound messages and by providing clearer errors when required params are missing.

Checklist

- [ ] `npm install` locally and run `npm test` (Jest tests require dev deps)
- [ ] Verify CI passes on the PR
- [ ] If enabling live Twilio sends for testing, set `ENABLE_TWILIO=true` and add Twilio secrets to GitHub Actions (or local `.env`)

Commands (copy-paste)

```bash
# create branch
git checkout -b feat/twilio-safety-tests
git add -A
git commit -m "chore(twilio): add validation, dry-run metadata, tests and docs"
git push -u origin feat/twilio-safety-tests

# create PR with gh CLI (optional)
gh pr create --title "Improve Twilio safety, tests, and docs" --body-file PR_BODY.md
```

Notes

- I added a Jest test in `__tests__/twilio-wrapper.test.js`. Your local environment will need `npm install` to run it.
- The quick node tests (`node test/run-tests.js`) are unchanged and still pass.
