"""Write mobile/src/demo/content.json: the life-event templates, assistant sources and
provider directory, so the browser demo uses the same content as the API.

Run from backend/:  python scripts/export_demo_content.py
"""

import json
from pathlib import Path

import yaml

PLUGINS = Path(__file__).resolve().parents[1] / "settlewise" / "plugins"
OUT = Path(__file__).resolve().parents[2] / "mobile" / "src" / "demo" / "content.json"


def main() -> None:
    templates = [yaml.safe_load(p.read_text()) for p in sorted((PLUGINS / "planning" / "templates").glob("*.yaml"))]
    content = {
        "templates": templates,
        "sources": yaml.safe_load((PLUGINS / "assistant" / "sources.yaml").read_text()),
        "providers": yaml.safe_load((PLUGINS / "referrals" / "providers.yaml").read_text()),
    }
    OUT.write_text(json.dumps(content, indent=1, default=str) + "\n")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
