from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models, schemas
from app.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/extraction", tags=["extraction"])


# ── メーカー設定 CRUD ──────────────────────────────────────────────────────────

@router.get("/configs", response_model=List[schemas.MakerExtractionConfigOut])
def get_configs(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.MakerExtractionConfig).order_by(models.MakerExtractionConfig.maker_name).all()


@router.post("/configs", response_model=schemas.MakerExtractionConfigOut)
def create_config(
    payload: schemas.MakerExtractionConfigCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    existing = db.query(models.MakerExtractionConfig).filter(
        models.MakerExtractionConfig.maker_name == payload.maker_name
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="このメーカー名は既に登録されています")

    config = models.MakerExtractionConfig(
        maker_name=payload.maker_name,
        excel_file_path=payload.excel_file_path,
        map_save_path=payload.map_save_path,
        map_date_field=payload.map_date_field,
        map_required=payload.map_required,
    )
    db.add(config)
    db.flush()

    for i, f in enumerate(payload.fields):
        field = models.ExtractionField(
            config_id=config.id,
            field_name=f.field_name,
            field_type=f.field_type,
            required=f.required,
            order=f.order if f.order else i,
            aliases=f.aliases,
        )
        db.add(field)

    db.commit()
    db.refresh(config)
    return config


@router.put("/configs/{config_id}", response_model=schemas.MakerExtractionConfigOut)
def update_config(
    config_id: int,
    payload: schemas.MakerExtractionConfigUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    config = db.query(models.MakerExtractionConfig).filter(
        models.MakerExtractionConfig.id == config_id
    ).first()
    if not config:
        raise HTTPException(status_code=404, detail="設定が見つかりません")

    if payload.maker_name is not None:
        config.maker_name = payload.maker_name
    if payload.excel_file_path is not None:
        config.excel_file_path = payload.excel_file_path
    if payload.map_save_path is not None:
        config.map_save_path = payload.map_save_path
    if payload.map_date_field is not None:
        config.map_date_field = payload.map_date_field
    if payload.map_required is not None:
        config.map_required = payload.map_required

    if payload.fields is not None:
        db.query(models.ExtractionField).filter(
            models.ExtractionField.config_id == config_id
        ).delete()
        for i, f in enumerate(payload.fields):
            field = models.ExtractionField(
                config_id=config_id,
                field_name=f.field_name,
                field_type=f.field_type,
                required=f.required,
                order=f.order if f.order else i,
                aliases=f.aliases,
            )
            db.add(field)

    db.commit()
    db.refresh(config)
    return config


@router.delete("/configs/{config_id}")
def delete_config(
    config_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    config = db.query(models.MakerExtractionConfig).filter(
        models.MakerExtractionConfig.id == config_id
    ).first()
    if not config:
        raise HTTPException(status_code=404, detail="設定が見つかりません")
    db.delete(config)
    db.commit()
    return {"ok": True}


# ── 抽出処理 ──────────────────────────────────────────────────────────────────

@router.post("/process/{email_id}")
def process_extraction(
    email_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = db.query(models.Email).filter(models.Email.id == email_id).first()
    if not email:
        raise HTTPException(status_code=404, detail="メールが見つかりません")

    background_tasks.add_task(_run_extraction, email_id)
    return {"ok": True, "message": "抽出処理を開始しました"}


def _run_extraction(email_id: int):
    import logging
    from app.database import SessionLocal
    from app.services.extraction_service import process_email_extraction
    _logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        result = process_email_extraction(email_id, db)
        _logger.info(f"手動抽出完了: email_id={email_id}, result={result}")
    except Exception as e:
        _logger.error(f"手動抽出エラー: email_id={email_id}, error={e}", exc_info=True)
        db.rollback()
    finally:
        db.close()


# ── 抽出結果 ──────────────────────────────────────────────────────────────────

@router.get("/results/{email_id}", response_model=List[schemas.ExtractionResultOut])
def get_results(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.ExtractionResult).filter(
        models.ExtractionResult.email_id == email_id
    ).order_by(models.ExtractionResult.created_at.desc()).all()


@router.put("/results/{result_id}/soonest-date")
def set_soonest_date(
    result_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin),
):
    """最短日を手動入力してExcelに書き込む（管理者のみ）"""
    from app.services.extraction_service import write_excel_row, save_map_to_nas
    result = db.query(models.ExtractionResult).filter(
        models.ExtractionResult.id == result_id
    ).first()
    if not result:
        raise HTTPException(status_code=404, detail="結果が見つかりません")
    if not result.needs_soonest_date or not result.soonest_date_field:
        raise HTTPException(status_code=400, detail="最短日入力待ち状態ではありません")

    date_value = payload.get("date")
    if not date_value:
        raise HTTPException(status_code=422, detail="date フィールドが必要です")

    data = dict(result.extracted_data or {})
    data[result.soonest_date_field] = date_value
    result.extracted_data = data
    result.needs_soonest_date = False
    result.soonest_date_field = None

    config = result.config
    ok = write_excel_row(data, config)
    if ok:
        result.status = "completed"
        result.excel_written = True
        email = result.email
        if email.status_record and email.status_record.status == models.EmailStatusEnum.needs_review:
            email.status_record.status = models.EmailStatusEnum.read
        db.commit()
        return {"ok": True}
    db.commit()
    raise HTTPException(status_code=500, detail="Excel書き込みに失敗しました")


@router.put("/results/{result_id}/confirm")
def confirm_result(
    result_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """要確認の結果を手動で確認済みにしてExcelに書き込む"""
    from app.services.extraction_service import write_excel_row, save_map_to_nas
    result = db.query(models.ExtractionResult).filter(
        models.ExtractionResult.id == result_id
    ).first()
    if not result:
        raise HTTPException(status_code=404, detail="結果が見つかりません")

    config = result.config
    ok = write_excel_row(result.extracted_data, config)
    if ok:
        result.status = "completed"
        result.excel_written = True
        email = result.email
        if email.status_record and email.status_record.status == models.EmailStatusEnum.needs_review:
            email.status_record.status = models.EmailStatusEnum.read
        db.commit()
        return {"ok": True}
    raise HTTPException(status_code=500, detail="Excel書き込みに失敗しました")
