# Backup and restore

## What exists
- **Neon history:** 6 hours of point-in-time recovery (plan limit). Restore from the Neon console, branch `main`, "Restore" to a timestamp.
- **Daily encrypted dump:** `.github/workflows/backup.yml` runs at 02:40 BRT, writes `peacelaw-<timestamp>.pgdump.gpg` (AES-256, symmetric) as the artifact `peacelaw-db-backup`, kept 14 days. A failed run e-mails the repository owner.
- **Secrets backup:** `JWT_SECRET`, `RAW_TEXT_KEYS`, the database URLs and `BACKUP_PASSPHRASE` are kept in the owner's password manager (a DPAPI-encrypted local copy exists on the owner's PC: see `Documents\PeaceLaw-secrets\LEIA-ME.txt`).

The dump holds personal data (e-mails, password hashes) and original reports already encrypted with `RAW_TEXT_KEYS`; the gpg layer protects the whole file. **Without `RAW_TEXT_KEYS` the original reports in a restored database cannot be read**, so keep both.

## Restore into a scratch database (never straight over production)
1. GitHub → Actions → "Database backup" → pick a run → download the artifact and unzip it.
2. Decrypt: `gpg --batch --pinentry-mode loopback --passphrase "<BACKUP_PASSPHRASE>" --output dump.pgdump --decrypt peacelaw-<timestamp>.pgdump.gpg`
3. Create an empty Neon branch or database and restore: `pg_restore --no-owner --no-privileges --dbname "<scratch url>" dump.pgdump`
4. Point a local backend at it (`DATABASE_URL`, `RAW_TEXT_KEYS`, `JWT_SECRET`) and check that logins and cases load.
5. Only then decide whether to copy anything back to production, table by table.

## Test the restore
Do the steps above once before launch and after any schema change that adds tables (the dump needs `SELECT` on them: grant it to `peacelaw_app` with the migration).
