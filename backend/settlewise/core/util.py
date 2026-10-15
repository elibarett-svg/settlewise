from typing import Any

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session


def apply_patch(obj: Any, body: BaseModel) -> Any:
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(obj, key, value)
    return obj


def dump_rows(db: Session, model, schema: type[BaseModel], user_id: str) -> list[dict]:
    rows = db.scalars(select(model).where(model.user_id == user_id)).all()
    return [schema.model_validate(r).model_dump(mode="json") for r in rows]


def delete_rows(db: Session, user_id: str, *models) -> None:
    for model in models:
        db.execute(delete(model).where(model.user_id == user_id))
