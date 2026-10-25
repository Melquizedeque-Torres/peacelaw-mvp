"""Erase the original report (raw_text) of cases resolved more than N days ago (LGPD retention).

Usage, from backend/:  .venv/Scripts/python -m scripts.purge_raw_text [--dry-run]
N is RAW_TEXT_RETENTION_DAYS (default 180). Prints a count and the erased case ids, never any text. Idempotent.
"""

import argparse

from app.db import _session_factory
from app.retention import purge_raw_text_ids, retention_days


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="only print how many cases match")
    args = parser.parse_args(argv)
    days = retention_days()
    with _session_factory()() as db:
        ids = purge_raw_text_ids(db, days=days, dry_run=args.dry_run)
    verb = "seriam apagados" if args.dry_run else "apagados"
    print(f"{len(ids)} relato(s) original(is) {verb} (casos encerrados há mais de {days} dias).")
    for case_id in ids:
        print(f"  caso {case_id}")


if __name__ == "__main__":
    main()
