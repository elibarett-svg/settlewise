"""Content-review helper (stakeholder S8): check every assistant source and provider
website still responds, and list entries that have never been reviewed.

Run from backend/:  python scripts/check_sources.py
"""

import sys
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[1] / "settlewise" / "plugins"


def main() -> int:
    sources = yaml.safe_load((ROOT / "assistant" / "sources.yaml").read_text())
    broken, unreviewed = [], []
    with httpx.Client(follow_redirects=True, timeout=15, headers={"User-Agent": "SettleWise-content-check"}) as client:
        for s in sources:
            try:
                status = client.head(s["url"]).status_code
                if status >= 400:
                    status = client.get(s["url"]).status_code
            except httpx.HTTPError as exc:
                status = f"error: {exc.__class__.__name__}"
            ok = isinstance(status, int) and status < 400
            print(f"{'OK ' if ok else 'BAD'} {status!s:>5}  {s['id']:<32} {s['url']}")
            if not ok:
                broken.append(s["id"])
            if not s.get("reviewed_on"):
                unreviewed.append(s["id"])
    print(f"\n{len(sources)} sources, {len(broken)} broken, {len(unreviewed)} awaiting content review")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
