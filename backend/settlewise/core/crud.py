"""Small helper that adds list/create/update/delete routes for a user-owned table."""

from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import get_current_user, get_owned
from .models import User

Hook = Callable[[Session, Any], None]


def register_crud(
    r: APIRouter,
    path: str,
    model,
    create_schema: type[BaseModel],
    patch_schema: type[BaseModel],
    out_schema: type[BaseModel],
    *,
    label: str,
    order_by=None,
    validate: Callable[[Session, User, dict], None] | None = None,
    after_save: Hook | None = None,
    before_delete: Hook | None = None,
    summary: str | None = None,
    include_list: bool = True,
) -> None:
    if include_list:

        @r.get(path, response_model=list[out_schema], name=f"list_{model.__tablename__}")
        def list_rows(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
            stmt = select(model).where(model.user_id == user.id)
            if order_by is not None:
                stmt = stmt.order_by(order_by)
            return db.scalars(stmt).all()

    @r.post(path, response_model=out_schema, status_code=201, summary=summary, name=f"create_{model.__tablename__}")
    def create_row(body: create_schema, user: User = Depends(get_current_user), db: Session = Depends(get_db)):  # type: ignore[valid-type]
        data = body.model_dump()
        if validate:
            validate(db, user, data)
        obj = model(user_id=user.id, **data)
        db.add(obj)
        db.flush()
        if after_save:
            after_save(db, obj)
        return obj

    @r.patch(f"{path}/{{obj_id}}", response_model=out_schema, name=f"update_{model.__tablename__}")
    def update_row(
        obj_id: str,
        body: patch_schema,  # type: ignore[valid-type]
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        obj = get_owned(db, model, obj_id, user.id, label)
        data = body.model_dump(exclude_unset=True)
        if validate:
            validate(db, user, data)
        for key, value in data.items():
            setattr(obj, key, value)
        db.flush()
        if after_save:
            after_save(db, obj)
        return obj

    @r.delete(f"{path}/{{obj_id}}", status_code=204, name=f"delete_{model.__tablename__}")
    def delete_row(obj_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        obj = get_owned(db, model, obj_id, user.id, label)
        if before_delete:
            before_delete(db, obj)
        db.delete(obj)
