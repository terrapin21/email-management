import csv
import io
import logging
import re
import chardet
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import models
from app.auth import get_current_user
from app.schemas import CsvUploadOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/csv", tags=["csv"])

# CSV列名の候補（部分一致で探す）
HATCHU_COL_KEYWORDS = ["発注No", "発注番号", "発注no"]
KAISHU_DATE_COL_KEYWORDS = ["回収日"]
NOUHIN_DATE_COL_KEYWORDS = ["納品日"]

# メール抽出フィールドの日付フィールド名候補
EMAIL_KAISHU_FIELD_KEYWORDS = ["回収日"]
EMAIL_NOUHIN_FIELD_KEYWORDS = ["納品日"]


def _decode_csv_bytes(data: bytes) -> str:
    """Shift-JIS / UTF-8 / UTF-8-BOM を自動判別してデコードする。"""
    detected = chardet.detect(data)
    encoding = detected.get("encoding") or "utf-8"
    for enc in [encoding, "utf-8-sig", "shift_jis", "cp932", "utf-8"]:
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace")


def _find_col_value(data: dict, *keywords: str) -> str:
    """キーワードでCSV列を部分一致で探して値を返す。"""
    for col, val in data.items():
        col_norm = col.strip().replace(" ", "").replace("　", "")
        for kw in keywords:
            kw_norm = kw.replace(" ", "").replace("　", "")
            if kw_norm in col_norm or col_norm in kw_norm:
                return str(val).strip() if val else ""
    return ""


def _find_field_value(field_map: dict, *keywords: str) -> tuple[Optional[str], Optional[str]]:
    """メール抽出フィールドからキーワードで部分一致して (field_name, field_value) を返す。"""
    for field_name, field_value in field_map.items():
        fname_norm = field_name.strip().replace(" ", "").replace("　", "")
        for kw in keywords:
            kw_norm = kw.replace(" ", "").replace("　", "")
            if kw_norm in fname_norm or fname_norm in kw_norm:
                return field_name, field_value
    return None, None


def _parse_date(value: str) -> Optional[datetime]:
    """日付文字列をパースする。複数フォーマット対応。"""
    if not value:
        return None
    value = value.strip()
    for fmt in ["%Y/%m/%d", "%Y-%m-%d", "%Y年%m月%d日", "%m/%d", "%m月%d日",
                "%Y.%m.%d", "%Y%m%d"]:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    # 数字だけからなる8桁 (20240115)
    if re.match(r"^\d{8}$", value):
        try:
            return datetime.strptime(value, "%Y%m%d")
        except ValueError:
            pass
    return None


def _is_specific_date(value: str) -> bool:
    """値が具体的な日付としてパース可能かどうか。"""
    return _parse_date(value) is not None


def _determine_reflection(
    email_date_str: str,
    csv_date_str: str,
    is_specific: bool,
) -> str:
    """反映状況を判定する。"""
    if is_specific:
        email_date = _parse_date(email_date_str)
        csv_date = _parse_date(csv_date_str)
        if email_date and csv_date and email_date.date() == csv_date.date():
            return "reflected"
        return "not_reflected"
    else:
        # 「最短回収」など日付なし → CSVに日付が入っていれば反映済み
        return "reflected" if csv_date_str else "not_reflected"


def run_matching(db: Session, upload: models.CsvUpload):
    """アップロードしたCSVと全メールのAI抽出フィールドを照合する（2軸ステータス）。"""
    records = db.query(models.CsvRecord).filter(
        models.CsvRecord.upload_id == upload.id
    ).all()
    if not records:
        return

    # 抽出フィールドを持つメールIDを先に取得してからメールを取得（JSON列のDISTINCT回避）
    field_email_ids = [
        row[0] for row in
        db.query(models.EmailField.email_id).distinct().all()
    ]
    if not field_email_ids:
        return

    emails_with_fields = (
        db.query(models.Email)
        .filter(models.Email.id.in_(field_email_ids))
        .all()
    )

    added = 0
    for email in emails_with_fields:
        # この upload に対して既にマッチ済みならスキップ
        existing = db.query(models.EmailCsvMatch).filter(
            models.EmailCsvMatch.email_id == email.id,
            models.EmailCsvMatch.upload_id == upload.id,
        ).first()
        if existing:
            continue

        field_records = db.query(models.EmailField).filter(
            models.EmailField.email_id == email.id
        ).all()
        field_map = {f.field_name: (f.field_value or "").strip()
                     for f in field_records if f.field_value}
        if not field_map:
            continue

        # ── Step 1: 発注No. で照合 ────────────────────────────────────────────
        matched_record = None
        match_field_name = None
        match_field_value = None

        for field_name, field_value in field_map.items():
            if not field_value:
                continue
            for record in records:
                csv_hatchu = _find_col_value(record.data, *HATCHU_COL_KEYWORDS)
                if csv_hatchu and csv_hatchu == field_value:
                    matched_record = record
                    match_field_name = field_name
                    match_field_value = field_value
                    break
            if matched_record:
                break

        if not matched_record:
            # 登録無し: EmailCsvMatchは作成しない（不在 = 登録無し）
            continue

        # ── Step 2: 反映状況を判定 ───────────────────────────────────────────
        reflection_status = None
        date_field_used = None

        # 回収日フィールドを探す
        kaishu_fname, kaishu_val = _find_field_value(field_map, *EMAIL_KAISHU_FIELD_KEYWORDS)
        # 納品日フィールドを探す
        nouhin_fname, nouhin_val = _find_field_value(field_map, *EMAIL_NOUHIN_FIELD_KEYWORDS)

        csv_kaishu = _find_col_value(matched_record.data, *KAISHU_DATE_COL_KEYWORDS)
        csv_nouhin = _find_col_value(matched_record.data, *NOUHIN_DATE_COL_KEYWORDS)

        if kaishu_val:
            date_field_used = kaishu_fname
            reflection_status = _determine_reflection(
                kaishu_val, csv_kaishu, _is_specific_date(kaishu_val)
            )
        elif nouhin_val:
            date_field_used = nouhin_fname
            reflection_status = _determine_reflection(
                nouhin_val, csv_nouhin, _is_specific_date(nouhin_val)
            )
        # どちらの日付フィールドもない場合: reflection_status = None

        match = models.EmailCsvMatch(
            email_id=email.id,
            csv_record_id=matched_record.id,
            upload_id=upload.id,
            match_field=match_field_name,
            match_value=match_field_value,
            reflection_status=reflection_status,
            date_field=date_field_used,
        )
        db.add(match)
        added += 1

    db.commit()
    logger.info(f"CSV照合完了: upload_id={upload.id}, 登録有り={added}件")


@router.post("/upload", response_model=CsvUploadOut)
async def upload_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """CSVファイルをアップロードして業務システムデータとして保存する。"""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="CSVファイルを選択してください")

    raw = await file.read()
    text = _decode_csv_bytes(raw)

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        raise HTTPException(status_code=400, detail="CSVにデータがありません")

    column_names = list(rows[0].keys())

    upload = models.CsvUpload(
        filename=file.filename,
        uploaded_by=current_user.id,
        row_count=len(rows),
        column_names=column_names,
    )
    db.add(upload)
    db.flush()

    for i, row in enumerate(rows):
        db.add(models.CsvRecord(
            upload_id=upload.id,
            row_index=i,
            data=dict(row),
        ))

    db.commit()
    db.refresh(upload)

    background_tasks.add_task(_run_matching_bg, upload.id)
    return upload


def _run_matching_bg(upload_id: int):
    from app.database import SessionLocal
    s = SessionLocal()
    try:
        upload = s.query(models.CsvUpload).get(upload_id)
        if upload:
            run_matching(s, upload)
    except Exception as e:
        logger.error(f"CSV照合バックグラウンドエラー: {e}", exc_info=True)
    finally:
        s.close()


@router.get("", response_model=List[CsvUploadOut])
def list_uploads(
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    from sqlalchemy.orm import joinedload
    return (
        db.query(models.CsvUpload)
        .options(joinedload(models.CsvUpload.uploader))
        .order_by(models.CsvUpload.uploaded_at.desc())
        .all()
    )


@router.delete("/{upload_id}")
def delete_upload(
    upload_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    upload = db.query(models.CsvUpload).get(upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="見つかりません")
    db.delete(upload)
    db.commit()
    return {"ok": True}


@router.post("/{upload_id}/rematch")
def rematch(
    upload_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    """指定CSVで全メールを再照合する。"""
    upload = db.query(models.CsvUpload).get(upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="見つかりません")
    # 既存マッチを削除
    db.query(models.EmailCsvMatch).filter(
        models.EmailCsvMatch.upload_id == upload_id
    ).delete()
    db.commit()
    background_tasks.add_task(_run_matching_bg, upload_id)
    return {"message": "再照合を開始しました"}
