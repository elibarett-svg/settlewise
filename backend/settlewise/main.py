import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .core import db
from .core.config import PHASES, Settings, get_settings
from .core.events import bus
from .core.plugin import PluginContext, registry

log = logging.getLogger("settlewise")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    bus.clear()
    registry.load(settings)
    ctx = PluginContext(settings=settings, bus=bus, registry=registry)
    for plugin in registry.all():
        plugin.setup(ctx)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db.Base.metadata.create_all(db.engine)
        with db.SessionLocal() as session:
            for plugin in registry.all():
                plugin.seed(session, ctx)
            if settings.seed_demo_data:
                from .seed import seed_demo

                seed_demo(session, settings)
            session.commit()
        tasks = []
        if settings.run_background_dispatcher:
            tasks = [asyncio.create_task(p.run_background(ctx)) for p in registry.all()]
        yield
        for task in tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="SettleWise API",
        version=__version__,
        description="Personal Digital Case Management System for newcomers to Canada.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for plugin in registry.all():
        router = plugin.build_router()
        if router is not None:
            app.include_router(router, prefix="/api/v1")

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok", "version": __version__}

    @app.get("/api/v1/meta", tags=["meta"])
    def meta():
        """Enabled features - the mobile app uses this as its feature flags."""
        return {
            "version": __version__,
            "phases": [p for p in PHASES if p in settings.enabled_phases],
            "plugins": [p.manifest() for p in registry.all()],
            "skipped": registry.skipped,
        }

    return app
