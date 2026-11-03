"""东方财富公开行情接口封装（无需 token）。

提供：实时行情、K 线、股票搜索、成交额/市值榜单、指数。
所有请求带简单内存缓存，避免频繁打接口。
"""

import json
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Referer": "https://quote.eastmoney.com/",
    "Accept": "*/*",
}

_session = requests.Session()
_session.headers.update(HEADERS)

_cache = {}
_cache_lock = threading.Lock()


def _cached(key, ttl, producer):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = producer()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def _get_json(url, timeout=10):
    resp = _session.get(url, timeout=timeout)
    resp.raise_for_status()
    text = resp.text.strip()
    if text.startswith("(") or text.startswith("jQuery"):
        start = text.find("(")
        text = text[start + 1:text.rfind(")")]
    return json.loads(text)


def _num(v):
    if v in (None, "", "-", "—"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ----------------------------- 行情 -----------------------------

QUOTE_FIELDS = ("f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f116,f117,"
                "f162,f167,f168,f169,f170,f18")


def _norm_quote(d):
    price = _num(d.get("f43"))
    prev = _num(d.get("f60")) or _num(d.get("f18"))
    stale = False
    if not price:
        price = prev
        stale = True
    pct = _num(d.get("f170"))
    chg = _num(d.get("f169"))
    if stale:
        pct = 0.0
        chg = 0.0
    return {
        "secid": None,
        "code": d.get("f57"),
        "name": d.get("f58"),
        "price": price,
        "prevClose": prev,
        "open": _num(d.get("f46")),
        "high": _num(d.get("f44")),
        "low": _num(d.get("f45")),
        "chg": chg,
        "pct": pct,
        "volume": _num(d.get("f47")),
        "amount": _num(d.get("f48")),
        "turnover": _num(d.get("f168")),
        "pe": _num(d.get("f162")),
        "pb": _num(d.get("f167")),
        "mcap": _num(d.get("f116")),
        "floatMcap": _num(d.get("f117")),
        "stale": stale,
    }


def get_quote(secid):
    def fetch():
        url = ("https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2"
               "&secid=%s&fields=%s" % (secid, QUOTE_FIELDS))
        data = _get_json(url).get("data") or {}
        q = _norm_quote(data)
        q["secid"] = secid
        return q
    return _cached("quote:" + secid, 5, fetch)


def get_quotes(secids):
    """批量行情：并发拉取单只接口（批量接口字段映射不稳定，这里不用）。"""
    secids = [s for s in secids if s][:40]
    if not secids:
        return {}
    out = {}

    def work(secid):
        try:
            return secid, get_quote(secid)
        except Exception:
            return secid, None

    with ThreadPoolExecutor(max_workers=min(8, len(secids))) as ex:
        for secid, q in ex.map(work, secids):
            if q and q.get("name"):
                out[secid] = q
    return out


def get_json_safe(url):
    try:
        return _get_json(url)
    except Exception:
        return None


def _secid_from_code(market, code):
    if market is None:
        return None
    try:
        return "%d.%s" % (int(market), code)
    except (TypeError, ValueError):
        return None


def secid_for(code):
    """根据 6 位代码推断 secid（1=沪市，0=深/北）。"""
    code = str(code).strip().upper().replace("SH", "").replace("SZ", "").replace("BJ", "")
    code = code.replace(".", "")
    if code.startswith("6"):
        return "1." + code
    return "0." + code


# ----------------------------- K 线 -----------------------------

def get_kline(secid, klt=101, limit=260):
    key = "kline:%s:%s:%s" % (secid, klt, limit)
    ttl = 90

    def fetch():
        url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get"
               "?secid=%s&klt=%s&fqt=1&lmt=%s&end=20500101"
               "&fields1=f1,f2,f3,f4,f5,f6"
               "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
               % (secid, klt, limit))
        data = _get_json(url).get("data") or {}
        rows = data.get("klines") or []
        name = data.get("name")
        code = data.get("code")
        out = []
        for row in rows:
            p = row.split(",")
            out.append({
                "d": p[0],
                "o": float(p[1]),
                "c": float(p[2]),
                "h": float(p[3]),
                "l": float(p[4]),
                "v": float(p[5]),
                "amount": float(p[6]) if len(p) > 6 and p[6] not in ("", "-") else 0.0,
                "pct": float(p[8]) if len(p) > 8 and p[8] not in ("", "-") else None,
            })
        return {"rows": out, "name": name, "code": code, "secid": secid}

    return _cached(key, ttl, fetch)


# ----------------------------- 分时（当日分钟数据） -----------------------------

def get_intraday(secid):
    """返回当日分时：时间、价格、均价、成交量、成交额。5 秒 TTL，交易时段实时。"""
    key = "intraday:" + secid
    ttl = 5

    def fetch():
        url = ("https://push2his.eastmoney.com/api/qt/stock/trends2/get"
               "?secid=%s&fields1=f1,f2,f3,f4,f5"
               "&fields2=f51,f52,f53,f54,f55,f56,f57,f58" % secid)
        data = _get_json(url).get("data") or {}
        trends = data.get("trends") or []
        name = data.get("name")
        code = data.get("code")
        prev = data.get("prePrice") or data.get("preprice")
        pre_close = _num(prev) or None
        out = []
        cumulative_v = 0.0
        cumulative_amount = 0.0
        for t in trends:
            p = t.split(",")
            if len(p) < 7:
                continue
            try:
                price = float(p[2])
                h = float(p[3])
                l = float(p[4])
                v = float(p[5])
                amount = float(p[6])
                avg = float(p[7]) if len(p) > 7 else None
            except (ValueError, IndexError):
                continue
            cumulative_v += v
            cumulative_amount += amount
            out.append({
                "t": p[0],  # "2026-11-03 09:31"
                "time": p[0].split(" ")[-1],  # "09:31"
                "price": price,
                "high": h,
                "low": l,
                "volume": v,
                "amount": amount,
                "cumVolume": cumulative_v,
                "cumAmount": cumulative_amount,
                "avg": avg,
                "pct": round((price / pre_close - 1) * 100, 2) if pre_close else None,
            })
        return {
            "rows": out,
            "name": name,
            "code": code,
            "secid": secid,
            "preClose": pre_close,
            "last": out[-1]["price"] if out else None,
        }

    return _cached(key, ttl, fetch)


# ----------------------------- 搜索 -----------------------------

ALLOWED_TYPES = {"沪A", "深A", "北交所", "科创板", "创业板"}


def search_stocks(keyword, count=8):
    keyword = (keyword or "").strip()
    if not keyword:
        return []

    def fetch():
        url = ("https://searchapi.eastmoney.com/api/suggest/get?input=%s"
               "&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=%s"
               % (urllib.parse.quote(keyword), count))
        data = _get_json(url)
        table = data.get("QuotationCodeTable") or {}
        items = table.get("Data") or []
        out = []
        for it in items:
            type_name = it.get("SecurityTypeName") or ""
            if it.get("Classify") != "AStock" and type_name not in ALLOWED_TYPES:
                continue
            out.append({
                "secid": it.get("QuoteID") or _secid_from_code(it.get("MktNum"), it.get("Code")),
                "code": it.get("Code"),
                "name": it.get("Name"),
                "type": type_name,
            })
        return out

    return _cached("search:" + keyword.lower(), 600, fetch)


# ----------------------------- 榜单 / 指数 -----------------------------

POOL_FIELDS = "f2,f3,f4,f6,f8,f9,f12,f13,f14,f18,f20,f21,f23,f62,f10,f5,f100"


def get_pool(size=100):
    """按流通市值取一个流动性较好的候选池（休市时价格字段为空也能取到池子）。"""
    key = "pool:%s" % size

    def fetch():
        url = ("https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=%s&po=1&np=1"
               "&fltt=2&invt=2&fid=f21&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"
               "&fields=%s" % (size, POOL_FIELDS))
        diff = (get_json_safe(url) or {}).get("data", {}).get("diff") or []
        out = []
        for it in diff:
            name = it.get("f14") or ""
            code = it.get("f12") or ""
            if "ST" in name.upper() or "退" in name or name.startswith("N"):
                continue
            out.append({
                "secid": _secid_from_code(it.get("f13"), code),
                "code": code,
                "name": name,
                "price": _num(it.get("f18")) or _num(it.get("f2")),
                "stale": _num(it.get("f2")) is None,
                "pct": _num(it.get("f3")),
                "amount": _num(it.get("f6")),
                "turnover": _num(it.get("f8")),
                "pe": _num(it.get("f9")),
                "mcap": _num(it.get("f20")),
                "floatMcap": _num(it.get("f21")),
                "pb": _num(it.get("f23")),
                "industry": it.get("f100") or "",
            })
        return out

    return _cached(key, 300, fetch)


INDICES = [("1.000001", "上证指数"), ("0.399001", "深证成指"),
           ("0.399006", "创业板指"), ("1.000300", "沪深300")]


def get_indices():
    def fetch():
        out = []
        for secid, name in INDICES:
            try:
                q = get_quote(secid)
                q["name"] = q.get("name") or name
                q["secid"] = secid
                out.append(q)
            except Exception:
                pass
        return out
    return _cached("indices", 15, fetch)
