"""智选股 —— 本地服务入口。

启动：python server.py  (默认 http://127.0.0.1:8765)

接口：
  GET /api/market                 指数与市场快照
  GET /api/search?q=              A 股搜索
  GET /api/quotes?secids=1.600519,0.000001
  GET /api/analyze?secid=&klt=101 个股走势分析与 B/S 计划
  GET /api/recommend?limit=10     技术面选股榜单
"""

import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import analysis
import datasource

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

KL_LIMIT = {101: 260, 102: 220, 60: 320}
_rec_cache = {}


def _round(v, n=2):
    return None if v is None else round(v, n)


# ----------------------------- 个股分析 -----------------------------

def analyze_one(secid, klt=101):
    klt = klt if klt in KL_LIMIT else 101
    kline = datasource.get_kline(secid, klt, KL_LIMIT[klt])
    rows = kline.get("rows") or []
    if len(rows) < 75:
        raise ValueError("历史 K 线不足，暂无法分析")

    code = kline.get("code") or secid.split(".")[-1]
    name = kline.get("name") or code
    quote = datasource.get_quote(secid)
    if not quote.get("name"):
        quote["name"] = name

    last = rows[-1]
    meta = {
        "secid": secid,
        "code": code,
        "name": name,
        "klt": klt,
        "lastDate": last["d"],
        "price": last["c"],
        "pct": last["pct"],
        "klineCount": len(rows),
    }
    result = analysis.build_analysis(meta, rows, quote)
    result["meta"] = meta
    result["updatedAt"] = int(time.time())
    return result


# ----------------------------- 选股 -----------------------------

def _tags(series, plan):
    n = len(series["c"])
    tags = []
    close = series["c"][n - 1]
    ma20, ma60 = series["ma20"][n - 1], series["ma60"][n - 1]
    if ma20 and ma60 and close > ma20 > ma60:
        tags.append("多头排列")
    if any(analysis._cross_up(series["dif"], series["dea"], j) for j in range(max(1, n - 5), n)):
        tags.append("MACD金叉")
    v5, v20 = series["vma5"][n - 1], series["vma20"][n - 1]
    if v5 and v20 and v5 / v20 >= 1.2:
        tags.append("量能放大")
    hh = max(series["h"][-60:])
    if close >= hh * 0.97:
        tags.append("逼近前高")
    r = series["rsi"][n - 1]
    if r and 45 <= r <= 70:
        tags.append("动能健康")
    if ma20 and close <= ma20 * 1.03 and close > ma20:
        tags.append("回踩均线")
    return tags[:4]


def _grade(score):
    if score >= 80:
        return "重点"
    if score >= 70:
        return "关注"
    return "观察"


def recommend(limit=10, pool_size=150):
    cache_key = (limit, pool_size)
    hit = _rec_cache.get(cache_key)
    if hit and time.time() - hit[0] < 120:
        return hit[1]

    pool = datasource.get_pool(pool_size)
    if not pool:
        raise ValueError("候选池获取失败，请稍后重试")

    def work(item):
        if not item.get("price") or item["price"] < 3:
            return None
        if (item.get("pct") or 0) >= 9.5 or (item.get("pct") or 0) <= -6:
            return None
        if (item.get("floatMcap") or 0) < 2e9:
            return None
        try:
            kline = datasource.get_kline(item["secid"], 101, 260)
            rows = kline.get("rows") or []
            if len(rows) < 90:
                return None
            pct = item.get("pct")
            if pct is None:
                pct = rows[-1]["pct"]
            quote = {
                "price": rows[-1]["c"],
                "pct": pct,
                "amount": item.get("amount"),
                "turnover": item.get("turnover"),
                "pe": item.get("pe"),
                "floatMcap": item.get("floatMcap"),
                "mcap": item.get("mcap"),
                "stale": item.get("stale"),
            }
            meta = {
                "secid": item["secid"], "code": item["code"],
                "name": item["name"], "klt": 101, "lastDate": rows[-1]["d"],
                "price": rows[-1]["c"], "pct": rows[-1]["pct"],
            }
            res = analysis.build_analysis(meta, rows, quote)
            plan = res["plan"]
            score = plan["score"]
            if score < 58:
                return None
            chg5 = (rows[-1]["c"] / rows[-6]["c"] - 1) * 100
            chg20 = (rows[-1]["c"] / rows[-21]["c"] - 1) * 100
            return {
                "secid": item["secid"],
                "code": item["code"],
                "name": item["name"],
                "industry": item.get("industry") or "",
                "price": item["price"],
                "pct": round(pct or 0, 2),
                "stale": bool(item.get("stale")),
                "amount": item.get("amount"),
                "floatMcap": item.get("floatMcap"),
                "pe": item.get("pe"),
                "score": score,
                "grade": _grade(score),
                "tags": _tags(res["series"], plan),
                "trend": plan["trend"],
                "trendCode": plan["trendCode"],
                "action": plan["action"],
                "actionCode": plan["actionCode"],
                "buyZone": plan["buyZone"],
                "stop": plan["stop"],
                "target1": plan["target1"],
                "target2": plan["target2"],
                "support": plan["support"],
                "resistance": plan["resistance"],
                "summary": plan["summary"],
                "reasons": plan["reasons"][:3],
                "risks": plan["risks"][:3],
                "rr": plan["rr"],
                "chg5": round(chg5, 2),
                "chg20": round(chg20, 2),
                "spark": [round(r["c"], 2) for r in rows[-30:]],
            }
        except Exception:
            return None

    results = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(work, pool):
            if r:
                results.append(r)
    results.sort(key=lambda x: (-x["score"], -(x["amount"] or 0)))

    picked, per_industry = [], {}
    for r in results:
        ind = r["industry"] or "其他"
        if per_industry.get(ind, 0) >= 2:
            continue
        per_industry[ind] = per_industry.get(ind, 0) + 1
        picked.append(r)
        if len(picked) >= limit:
            break

    _rec_cache[cache_key] = (time.time(), (picked, len(pool)))
    return picked, len(pool)


# ----------------------------- HTTP -----------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "ZhiXuanGu/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def end_headers(self):
        for k, v in CORS.items():
            self.send_header(k, v)
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message, status=500, code="error"):
        self._json({"error": message, "code": code}, status)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        try:
            if path.startswith("/api/"):
                self._handle_api(path, query)
            else:
                self._serve_static(path)
        except ValueError as e:
            self._error(str(e), 400, "bad_request")
        except Exception as e:
            traceback.print_exc()
            self._error("服务异常：%s" % e, 500, "server_error")

    def _handle_api(self, path, query):
        def one(name, default=None):
            return (query.get(name) or [default])[0]

        if path == "/api/health":
            return self._json({"ok": True, "time": int(time.time())})

        if path == "/api/market":
            return self._json({"indices": datasource.get_indices(), "time": int(time.time())})

        if path == "/api/search":
            return self._json({"items": datasource.search_stocks(unquote(one("q", "")), 8)})

        if path == "/api/quotes":
            secids = [s for s in (one("secids", "") or "").split(",") if s]
            if not secids:
                return self._json({"quotes": []})
            quotes = datasource.get_quotes(secids[:40])
            return self._json({"quotes": list(quotes.values()), "time": int(time.time())})

        if path == "/api/analyze":
            secid = one("secid") or datasource.secid_for(one("code", ""))
            if not secid:
                return self._error("缺少 secid 或 code", 400)
            klt = int(one("klt", "101") or 101)
            return self._json(analyze_one(secid, klt))

        if path == "/api/intraday":
            secid = one("secid") or datasource.secid_for(one("code", ""))
            if not secid:
                return self._error("缺少 secid 或 code", 400)
            data = datasource.get_intraday(secid)
            data["time"] = int(time.time())
            return self._json(data)

        if path == "/api/recommend":
            limit = max(3, min(30, int(one("limit", "10") or 10)))
            items, total = recommend(limit)
            return self._json({
                "items": items,
                "scanned": total,
                "time": int(time.time()),
                "note": "基于日 K 线技术面打分（趋势/MACD/RSI/量能/位置），仅供研究，不构成投资建议",
            })

        return self._error("未知接口：%s" % path, 404, "not_found")

    def _serve_static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = unquote(path).lstrip("/").replace("\\", "/")
        if ".." in rel:
            return self._error("非法路径", 403)
        full = os.path.join(WEB_DIR, rel)
        if not os.path.isfile(full):
            return self._error("文件不存在：" + rel, 404)
        mime = MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def find_port(start=8765):
    """优先读环境变量 PORT（云部署），否则从 start 起尝试，本地绑定 127.0.0.1，云绑定 0.0.0.0。"""
    env_port = os.environ.get("PORT")
    if env_port:
        try:
            port = int(env_port)
            host = "0.0.0.0"
            return ThreadingHTTPServer((host, port), Handler), port, host
        except (ValueError, OSError):
            pass
    host = "127.0.0.1"
    for port in range(start, start + 30):
        try:
            srv = ThreadingHTTPServer((host, port), Handler)
            return srv, port, host
        except OSError:
            continue
    raise SystemExit("没有可用端口")


if __name__ == "__main__":
    os.makedirs(WEB_DIR, exist_ok=True)
    srv, port, host = find_port()
    print("智选股已启动： http://%s:%d  （Ctrl+C 停止）" % (host if host != "0.0.0.0" else "127.0.0.1", port), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
