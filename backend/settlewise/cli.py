"""Command line entry point: ``settlewise serve | seed | dispatch | plugins``."""

import argparse

from .core import db
from .core.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="settlewise")
    sub = parser.add_subparsers(dest="cmd", required=True)
    serve = sub.add_parser("serve", help="Run the API server")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    sub.add_parser("seed", help="Create the synthetic demo accounts (Sarah + a settlement worker)")
    sub.add_parser("dispatch", help="Send due reminders once (for cron)")
    sub.add_parser("plugins", help="List plugins and whether they load")
    args = parser.parse_args()

    if args.cmd == "serve":
        import uvicorn

        uvicorn.run("settlewise.asgi:app", host=args.host, port=args.port, reload=args.reload)
        return

    from .main import create_app

    settings = get_settings()
    create_app(settings)
    db.Base.metadata.create_all(db.engine)

    if args.cmd == "seed":
        from .seed import seed_demo

        with db.SessionLocal() as session:
            print(seed_demo(session, settings))
            session.commit()
    elif args.cmd == "dispatch":
        from .plugins.notifications.service import dispatch_due

        with db.SessionLocal() as session:
            sent = dispatch_due(session, settings)
            session.commit()
        print(f"Dispatched {sent} notification(s)")
    elif args.cmd == "plugins":
        from .core.plugin import registry

        for p in registry.all():
            print(f"  loaded   {p.feature_id:>5}  {p.name:<14} {p.phase:<10} {p.title}")
        for name, reason in registry.skipped.items():
            print(f"  skipped         {name:<14} {reason}")


if __name__ == "__main__":
    main()
