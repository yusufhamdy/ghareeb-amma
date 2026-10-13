# GitHub Actions (Phase 5B T6)

Prepared only. Nothing here is pushed or enabled yet.

## Workflows

| File | Trigger | Deploys | Gating |
| --- | --- | --- | --- |
| `ci.yml` | push to `rebuild`, all PRs | nothing | none |
| `preview.yml` | push to `rebuild`, PRs | Hosting preview channel only | `vars.PREVIEW_ENABLED == 'true'` (set at Gate G2); fork PRs excluded |
| `release.yml` | push to `main` | Firestore rules, Functions, Hosting | `main` only + must be latest `origin/main` |

## Deployment policy

- GitHub Actions is the single official deployment path from this point on.
- Do not run `firebase deploy` locally in parallel with a workflow run.
- Release jobs never fire from `rebuild`; preview channels never touch Functions,
  Firestore rules, or indexes.

## Pinned actions

All actions are pinned to commit SHAs:

- `actions/checkout`  `11d5960a326750d5838078e36cf38b85af677262`
- `actions/setup-node` `49933ea5288caeca8642d1e84afbd3f7d6820020`
- `actions/setup-java` `cf277c60eb25467037889841efdb72551f06f6c3`
- `google-github-actions/auth` `c200f3691d83b41bf9bbd8638997a462592937ed`
- `FirebaseExtended/action-hosting-deploy` `500ac625ca2dd40cbd15f7659af953801858032a`

## Required secrets / variables (configure at Gate G2/G3, not now)

- `FIREBASE_SERVICE_ACCOUNT` - protected repo secret used by preview deploys.
- `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT` - preferred keyless auth for releases.
- Repository variable `PREVIEW_ENABLED` - set to `true` only when preview
  channels are approved.

## CI notes

- `ci.yml` installs Temurin Java 21 because the Firestore emulator requires it.
- The Stage A Arabic guard (`test/arabic-guard.test.js`) skips in a fresh CI
  checkout: its baseline fixture and the untracked `ghareeb-handoff/` bundle are
  not committed. It always runs in the full local environment.
