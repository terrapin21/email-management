from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models
from app.auth import get_current_user, require_admin
from app.schemas import ForwardingRuleCreate, ForwardingRuleUpdate, ForwardingRuleOut

router = APIRouter(prefix="/api/forwarding", tags=["forwarding"])


@router.get("", response_model=List[ForwardingRuleOut])
def list_rules(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    return db.query(models.ForwardingRule).order_by(models.ForwardingRule.id).all()


@router.post("", response_model=ForwardingRuleOut)
def create_rule(
    payload: ForwardingRuleCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    label = db.query(models.Label).get(payload.label_id)
    if not label:
        raise HTTPException(status_code=404, detail="ラベルが見つかりません")
    rule = models.ForwardingRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=ForwardingRuleOut)
def update_rule(
    rule_id: int,
    payload: ForwardingRuleUpdate,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    rule = db.query(models.ForwardingRule).get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="ルールが見つかりません")
    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(rule, field, val)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}")
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_admin),
):
    rule = db.query(models.ForwardingRule).get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="ルールが見つかりません")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@router.post("/{rule_id}/toggle", response_model=ForwardingRuleOut)
def toggle_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    rule = db.query(models.ForwardingRule).get(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="ルールが見つかりません")
    rule.is_active = not rule.is_active
    db.commit()
    db.refresh(rule)
    return rule
