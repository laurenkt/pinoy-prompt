# Pinoy Prompt

Vite + TypeScript PWA, no framework. See README.md for how the app works, and docs/ARCHITECTURE.md for which module owns each system and how screens are laid out: extend the owner rather than adding a parallel system.

- Before opening a PR: `npm test` and `npm run build`. For UI changes, screenshot Home and the changed screens at 360px and 390px wide with `npm run screenshots -- <out-dir>`.
- Code review (including `/code-review`) checks the change against REVIEW.md as well as for bugs. Anything that breaks a point there is a finding.
- Merging: a PR is merged only when GitHub says it is. After merging, read the PR back and check it shows as merged before telling anyone it is. A PR that conflicts with `main` gets no CI and wakes nobody, so if a merge is refused, merge `main` into the branch, run the tests and build, push, wait for CI on the new commit, then merge. Before finishing a thread, check none of its PRs are still open. After every push to `main`, and hourly, `.github/workflows/open-prs.yml` comments on any open non-draft PR that conflicts with `main` or has been open two hours (CI green but not merged, or CI failing). The repo has no issues, so the comment is the whole signal. A comment from it on your PR means it is stuck: deal with it as above.
