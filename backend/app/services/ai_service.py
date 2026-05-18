import json
import logging
from typing import Optional
import anthropic
from app.config import settings

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


def analyze_email(
    subject: str,
    from_address: str,
    from_name: str,
    body_text: str,
    available_labels: list[dict],
) -> dict:
    """
    Claude APIでメールを解析し、ラベル候補・カテゴリ・メーカー等を返す。
    """
    label_list = "\n".join(
        f"- {lb['name']} (type: {lb['label_type']}, id: {lb['id']}){(' / ' + lb['description']) if lb.get('description') else ''}"
        for lb in available_labels
    )

    truncated_body = body_text[:3000] if body_text else "(本文なし)"

    prompt = f"""以下のメールを解析してください。JSON形式のみで回答してください。

## メール情報
送信者: {from_name} <{from_address}>
件名: {subject}
本文:
{truncated_body}

## 利用可能なラベル一覧
{label_list if label_list else "(ラベルなし)"}

## ラベル選択の厳格なルール
- ラベルはメール本文・件名に**明確な根拠がある場合のみ**付与してください
- 「可能性がある」「関連しそう」という理由では付与しないでください
- ラベルの説明文がある場合、その説明に合致する内容が本文に含まれている場合のみ付与してください
- 確信が持てない場合は suggested_label_ids を空配列にしてください
- manufacturer はメール本文や署名に会社名・メーカー名が明記されている場合のみ設定してください

## 項目抽出ルール
- メール本文中に「項目名：値」「項目名:値」のような形式で記載されたデータをすべて抽出してください
- 例：「コード：A-1234」「回収品目：段ボール」「回収日：4月25日」「連絡先：03-1234-5678」
- 項目名と値のペアをすべて extracted_fields に含めてください
- 明確に記載されている場合のみ抽出し、推測はしないでください
- 【重要】施主No・施主コード・工事番号・現場コード・発注No・案件No・物件コードなど案件を特定する固有IDは、メール内での呼び名に関わらず必ず **「コード」** というキー名で extracted_fields に格納してください。値にIDと名称（〇〇様邸・〇〇邸・〇〇様など）が続けて記載されていても**ID部分のみ**を抽出してください。例：「AABBCC〇〇様邸」→「AABBCC」、「A-1234田中様邸」→「A-1234」（英数字やハイフンで構成される固有コード部分のみが対象です）
- 【重要】同じメール内にコードが複数存在する場合は、**1つの「コード」キーにまとめてカンマ区切り**で値を設定してください。例：「ABCD,EFGH,IJKL」
- 【重要】日付項目は以下の正規化ルールに従って統一したキー名で格納してください（メール内の表現に関わらず）：
  - 回収日・回収予定日・希望回収日・引き取り日・引き取り予定日・集荷日・集荷予定日 → 「回収日」
  - 納品日・納品予定日・希望納品日・出荷日・出荷予定日・配送日・配送予定日 → 「納品日」
  - 工事日・工事予定日・施工日・施工予定日・作業日・作業予定日 → 「工事日」
  - 上記以外の日付項目はメール内の表記をそのまま使用してください

## 回答形式（JSON）
{{
  "manufacturer": "送信者の会社名・メーカー名（本文や署名に明記されている場合のみ、それ以外はnull）",
  "category": "メール本文に明確な根拠がある場合のみラベル名を設定、なければnull",
  "priority": "high（緊急・クレーム・期限切迫）|medium（通常業務）|low（情報共有・挨拶）",
  "summary": "メール内容の日本語要約（100文字以内）",
  "key_info": {{
    "product": "製品名（本文に記載があれば）",
    "amount": "金額（本文に記載があれば）",
    "deadline": "期限・納期（本文に明記されていれば）",
    "action_required": "必要な対応（あれば）"
  }},
  "extracted_fields": {{
    "項目名": "値（本文に明記されている項目のみ。なければ空オブジェクト）"
  }},
  "suggested_label_ids": [本文に明確な根拠があるラベルIDのみ。確信がなければ空配列]
}}"""

    try:
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # JSONブロックを抽出
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0].strip()
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning(f"AI解析 JSONパースエラー: {e}, raw={raw[:200]}")
        return _fallback_result()
    except Exception as e:
        logger.error(f"AI解析エラー: {e}")
        return _fallback_result()


def _fallback_result() -> dict:
    return {
        "manufacturer": None,
        "category": "その他",
        "priority": "medium",
        "summary": "AI解析に失敗しました",
        "key_info": {},
        "extracted_fields": {},
        "suggested_label_ids": [],
    }
