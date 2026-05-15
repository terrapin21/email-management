from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models
from app.auth import get_current_user, require_admin
from app.schemas import LabelCreate, LabelUpdate, LabelOut

router = APIRouter(prefix="/api/labels", tags=["labels"])


@router.get("", response_model=List[LabelOut])
def list_labels(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return db.query(models.Label).filter(models.Label.is_active == True).order_by(models.Label.name).all()


@router.post("", response_model=LabelOut)
def create_label(
    payload: LabelCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    existing = db.query(models.Label).filter(models.Label.name == payload.name).first()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="同名のラベルが既に存在します")
        # 無効化済みの同名ラベルを再有効化して設定を更新
        existing.color = payload.color
        existing.description = payload.description
        existing.label_type = payload.label_type
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing
    label = models.Label(**payload.model_dump())
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.put("/{label_id}", response_model=LabelOut)
def update_label(
    label_id: int,
    payload: LabelUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    label = db.query(models.Label).get(label_id)
    if not label:
        raise HTTPException(status_code=404, detail="ラベルが見つかりません")
    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(label, field, val)
    db.commit()
    db.refresh(label)
    return label


@router.delete("/{label_id}")
def delete_label(
    label_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_admin),
):
    label = db.query(models.Label).get(label_id)
    if not label:
        raise HTTPException(status_code=404, detail="ラベルが見つかりません")
    label.is_active = False
    db.commit()
    return {"ok": True}
