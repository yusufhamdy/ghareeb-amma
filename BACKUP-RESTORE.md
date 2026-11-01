# Backup and restore

`.github/workflows/backup.yml` copies the Firestore data once a day, and whenever it is run by hand. Run it by hand before every Firestore rules deploy.

- **What it copies:** `public/data`, `public/challenge`, `public/prev`, `admin/challengeNotes`, `config/admins`, `snapshots/` and `history/`.
- **How it is protected:** encrypted with [age](https://age-encryption.org) to a public key before it leaves the runner. No private key exists in CI.
- **Where it goes:** a private GitHub repository, in `backups/`. Never as an Actions artifact, because this repository is public.
- **How long it stays:** the newest backup of each of the latest 14 days, 8 weeks and 12 months that have one.

`config/admins` showing as absent in an export is normal when no extra admin has been added: the owner is named in the rules, and the document is only created when an extra admin is added.

## Setup (owner, one time)

1. **Generate the key offline.** On your own machine, install age, then run `age-keygen -o ghareeb-backup.key`. It prints the public key, which starts `age1`.
2. **Keep the private key safe.** Store `ghareeb-backup.key` in a password manager, plus one sealed offline copy, such as an encrypted USB drive in a separate place. Never put it in this repository, in a secret or in chat. If it is lost, every backup is unreadable.
3. **Create the destination.** Create a new empty **private** repository, for example `yusufhamdy/ghareeb-amma-backups`.
4. **Make a deploy key.** Run `ssh-keygen -t ed25519 -f backup-deploy -N "" -C ghareeb-backup`. In the private repository, go to Settings, Deploy keys, Add deploy key, paste `backup-deploy.pub`, and tick **Allow write access**. Delete both local files after step 5.
5. **Add these to this repository's settings:**

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `BACKUP_DEPLOY_KEY` | The contents of `backup-deploy` (the private half of the deploy key) |
   | Variable | `BACKUP_AGE_RECIPIENT` | The `age1...` public key |
   | Variable | `BACKUP_REPO` | `yusufhamdy/ghareeb-amma-backups` |
   | Variable | `BACKUP_ENABLED` | `true`, only after merging |

   `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` already exist.
6. **Run it once by hand,** from the Actions tab on `main`, and check that one `.age` file appeared in the private repository.
7. **Rehearse a restore** (below) with that file.

## Rehearse a restore

Run this on your own machine, from this repository. It decrypts locally, loads into the emulator only, and cannot write to production.

```
npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/backup-restore-rehearsal.mjs --file backup-....age --identity /path/to/ghareeb-backup.key"
```

You should see `REHEARSAL PASSED`. Do this at least every three months: a backup nobody has restored is not yet a backup.

## A real restore

This is a separately authorized step, and the rehearsal never does it.

1. Rehearse the backup you intend to use, adding `--compare <a fresh export folder>` to see how many documents differ from production.
2. Restore the words as a new version, not by overwriting: in the admin, use **Import** with the decrypted words, or **Restore** if the version is still in the history. Both record a new version that can be undone.
3. Only if the admin can't be used, write with the Admin SDK, after a fresh export of the current state.

## If something leaks

- **Deploy key exposed:** remove it in the private repository's settings, make a new one, and replace `BACKUP_DEPLOY_KEY`.
- **Private age key exposed:** make a new keypair, update `BACKUP_AGE_RECIPIENT`, and treat existing backups as readable by whoever has the old key.
