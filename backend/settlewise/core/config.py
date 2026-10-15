from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

PHASES = ("MVP", "Growth", "Enterprise")


class Settings(BaseSettings):
    """Runtime configuration. Every field can be set with a SETTLEWISE_* environment variable."""

    model_config = SettingsConfigDict(env_prefix="SETTLEWISE_", env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "sqlite:///./settlewise.db"
    secret_key: str = "dev-only-insecure-secret-change-me-in-production"
    access_token_minutes: int = 60 * 24 * 7
    cors_origins: list[str] = ["*"]

    # Delivery phases from the Project Vision (Appendix B). Plugins tagged with a
    # phase that is not enabled are not loaded, so Growth/Enterprise features stay
    # off until their agreements and integrations exist.
    enabled_phases: list[str] = ["MVP"]
    disabled_plugins: list[str] = []

    # AI Settlement Assistant (3.0). Without an Anthropic credential the assistant
    # falls back to an offline, source-only answer.
    assistant_use_llm: bool = True
    anthropic_model: str = "claude-opus-5-5"

    # Notifications (9.0)
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"
    notification_dispatch_interval_seconds: int = 60
    run_background_dispatcher: bool = True

    # Seed data (synthetic records only, per the course prototype constraint)
    seed_demo_data: bool = False
    seed_demo_password: str = "settlewise-demo"

    @property
    def is_dev(self) -> bool:
        return self.env in {"dev", "test"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
