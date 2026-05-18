"""
HTTPリクエストから検出したサイトのベースURLをキャッシュする。
バックグラウンドジョブ（メール転送など）でもHTTPリクエスト外から参照できるようにする。
"""
_site_url: str = ""


def set_site_url(url: str) -> None:
    global _site_url
    _site_url = url


def get_site_url(fallback: str = "") -> str:
    return _site_url or fallback
