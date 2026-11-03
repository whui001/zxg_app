"""技术指标与策略引擎（纯标准库实现，无第三方依赖）。

指标：MA / MACD / RSI / BOLL / ATR / 量能
策略：MA 与 MACD 交叉生成历史 B/S 标记；综合打分；给出买入区间、止损、目标位。
"""

import math


# ----------------------------- 基础指标 -----------------------------

def sma(values, n):
    out = [None] * len(values)
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= n:
            total -= values[i - n]
        if i >= n - 1:
            out[i] = total / n
    return out


def ema(values, n):
    k = 2.0 / (n + 1)
    out = []
    prev = None
    for v in values:
        prev = v if prev is None else v * k + prev * (1 - k)
        out.append(prev)
    return out


def rsi(closes, n=14):
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = [0.0] * len(closes)
    losses = [0.0] * len(closes)
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i - 1]
        gains[i] = diff if diff > 0 else 0.0
        losses[i] = -diff if diff < 0 else 0.0
    avg_g = sum(gains[1:n + 1]) / n
    avg_l = sum(losses[1:n + 1]) / n
    out[n] = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1 + avg_g / avg_l)
    for i in range(n + 1, len(closes)):
        avg_g = (avg_g * (n - 1) + gains[i]) / n
        avg_l = (avg_l * (n - 1) + losses[i]) / n
        out[i] = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1 + avg_g / avg_l)
    return out


def boll(closes, n=20, k=2.0):
    mid = sma(closes, n)
    up = [None] * len(closes)
    low = [None] * len(closes)
    for i in range(n - 1, len(closes)):
        seg = closes[i - n + 1:i + 1]
        m = mid[i]
        sd = math.sqrt(sum((x - m) ** 2 for x in seg) / n)
        up[i] = m + k * sd
        low[i] = m - k * sd
    return up, mid, low


def atr(highs, lows, closes, n=14):
    out = [None] * len(closes)
    trs = [0.0] * len(closes)
    for i in range(len(closes)):
        if i == 0:
            trs[i] = highs[i] - lows[i]
        else:
            trs[i] = max(highs[i] - lows[i],
                         abs(highs[i] - closes[i - 1]),
                         abs(lows[i] - closes[i - 1]))
    if len(closes) < n + 1:
        return out
    a = sum(trs[1:n + 1]) / n
    out[n] = a
    for i in range(n + 1, len(closes)):
        a = (a * (n - 1) + trs[i]) / n
        out[i] = a
    return out


def macd(closes, fast=12, slow=26, signal=9):
    dif = [a - b for a, b in zip(ema(closes, fast), ema(closes, slow))]
    dea = ema(dif, signal)
    hist = [d - e for d, e in zip(dif, dea)]
    return dif, dea, hist


# ----------------------------- 工具函数 -----------------------------

def _round(v, digits=2):
    if v is None:
        return None
    return round(v, digits)


def _cross_up(fast, slow, i):
    if i < 1:
        return False
    a, b, c, d = fast[i - 1], slow[i - 1], fast[i], slow[i]
    if a is None or b is None or c is None or d is None:
        return False
    return a < b and c >= d


def _cross_down(fast, slow, i):
    if i < 1:
        return False
    a, b, c, d = fast[i - 1], slow[i - 1], fast[i], slow[i]
    if a is None or b is None or c is None or d is None:
        return False
    return a > b and c <= d


def _pivots(highs, lows, start, end, w=3):
    hs, ls = [], []
    for i in range(max(start, w), min(end, len(highs)) - w):
        if highs[i] == max(highs[i - w:i + w + 1]):
            hs.append(highs[i])
        if lows[i] == min(lows[i - w:i + w + 1]):
            ls.append(lows[i])
    return hs, ls


def _cluster(levels, close, above, max_gap=0.03, limit=3):
    """把相近价位聚合，返回离现价最近的若干档。"""
    if not levels:
        return []
    pool = sorted(set(levels), reverse=not above)
    picked = []
    for lv in pool:
        if (lv - close) > 0 if above else (close - lv) > 0:
            if all(abs(lv - p) / close > max_gap for p in picked):
                picked.append(lv)
        if len(picked) >= limit:
            break
    return sorted(picked)


# ----------------------------- 序列构建 -----------------------------

def build_series(klines):
    dates = [k["d"] for k in klines]
    o = [k["o"] for k in klines]
    h = [k["h"] for k in klines]
    l = [k["l"] for k in klines]
    c = [k["c"] for k in klines]
    v = [k["v"] for k in klines]

    ma5 = sma(c, 5)
    ma10 = sma(c, 10)
    ma20 = sma(c, 20)
    ma60 = sma(c, 60)
    dif, dea, hist = macd(c)
    r = rsi(c, 14)
    b_up, b_mid, b_low = boll(c, 20, 2)
    a = atr(h, l, c, 14)
    vma5 = sma(v, 5)
    vma20 = sma(v, 20)

    def fmt(seq, digits=3):
        return [_round(x, digits) for x in seq]

    return {
        "date": dates, "o": o, "h": h, "l": l, "c": c, "v": v,
        "ma5": fmt(ma5), "ma10": fmt(ma10), "ma20": fmt(ma20), "ma60": fmt(ma60),
        "dif": fmt(dif), "dea": fmt(dea), "hist": fmt(hist),
        "rsi": fmt(r, 2),
        "bollUp": fmt(b_up), "bollMid": fmt(b_mid), "bollLow": fmt(b_low),
        "atr": fmt(a), "vma5": fmt(vma5, 1), "vma20": fmt(vma20, 1),
    }


# ----------------------------- 历史 B/S 标记 -----------------------------

def build_signals(series):
    n = len(series["c"])
    ma5, ma20 = series["ma5"], series["ma20"]
    dif, dea = series["dif"], series["dea"]
    c = series["c"]
    signals = []
    last_idx = {"B": -99, "S": -99}

    def add(i, kind, reason):
        if i - last_idx[kind] < 6:
            return
        signals.append({
            "i": i,
            "d": series["date"][i],
            "type": kind,
            "price": round(c[i], 2),
            "reason": reason,
        })
        last_idx[kind] = i

    for i in range(60, n):
        if ma20[i] is None:
            continue
        # 均线金叉 / 死叉
        if _cross_up(ma5, ma20, i) and c[i] > ma20[i]:
            add(i, "B", "MA5 上穿 MA20，均线金叉")
        if _cross_down(ma5, ma20, i) and c[i] < ma20[i]:
            add(i, "S", "MA5 下穿 MA20，均线死叉")
        # MACD 金叉 / 死叉
        if _cross_up(dif, dea, i):
            if c[i] > ma20[i]:
                add(i, "B", "MACD 金叉且站上 20 日线")
            elif i - last_idx["B"] >= 6:
                add(i, "B", "MACD 金叉，短线反弹")
        if _cross_down(dif, dea, i) and c[i] < ma20[i]:
            add(i, "S", "MACD 死叉且跌破 20 日线")
        # 放量新高 / 跌破
        if i >= 20 and c[i] > max(series["h"][i - 20:i]):
            if series["v"][i] > (series["vma20"][i] or 0) * 1.3:
                add(i, "B", "放量创 20 日新高")
        if series["rsi"][i] and series["rsi"][i] > 82 and series["rsi"][i - 1] and series["rsi"][i] < series["rsi"][i - 1]:
            add(i, "S", "RSI 超买区回落")
    return signals


# ----------------------------- 打分 -----------------------------

def evaluate(series, klines):
    n = len(series["c"])
    close = series["c"][n - 1]
    ma5, ma20, ma60 = series["ma5"][n - 1], series["ma20"][n - 1], series["ma60"][n - 1]
    dif, dea, hist = series["dif"][n - 1], series["dea"][n - 1], series["hist"][n - 1]
    r = series["rsi"][n - 1]
    v5, v20 = series["vma5"][n - 1], series["vma20"][n - 1]
    b_up, b_low = series["bollUp"][n - 1], series["bollLow"][n - 1]
    a = series["atr"][n - 1]

    score = 0.0
    reasons, risks = [], []

    # 趋势 25
    if ma20:
        dev = (close / ma20 - 1) * 100
        if close > ma20:
            score += 8
            reasons.append("价格站上 20 日均线（%+.1f%%）" % dev)
        else:
            risks.append("价格位于 20 日均线下方（%+.1f%%）" % dev)
        if ma60 and ma20 > ma60:
            score += 8
            reasons.append("20 日线在 60 日线上方，中期多头排列")
        else:
            risks.append("中期均线尚未多头排列")
        if n >= 6 and series["ma20"][n - 6] and ma20 > series["ma20"][n - 6]:
            score += 9
            reasons.append("20 日均线向上倾斜")
        else:
            risks.append("20 日均线走平或向下")

    # MACD 20
    if dif is not None and dea is not None:
        if dif > dea:
            score += 8
            reasons.append("MACD 处于多头（DIF 在 DEA 上方）")
        else:
            risks.append("MACD 处于空头")
        if hist and hist > 0:
            score += 4
            reasons.append("MACD 柱状体为正")
        crossed = False
        for j in range(max(1, n - 5), n):
            if _cross_up(series["dif"], series["dea"], j):
                crossed = True
        if crossed:
            score += 8
            reasons.append("近 5 日出现 MACD 金叉")

    # RSI 15
    if r is not None:
        if 45 <= r <= 70:
            score += 15
            reasons.append("RSI %.0f，处于健康区间" % r)
        elif 70 < r <= 80:
            score += 10
            reasons.append("RSI %.0f，偏强但未极端" % r)
        elif r < 45:
            score += 5
            risks.append("RSI %.0f，动能偏弱" % r)
        else:
            risks.append("RSI %.0f，超买风险" % r)

    # 量能 15
    if v5 and v20:
        ratio = v5 / v20 if v20 else 1
        up5 = close > series["c"][n - 6] if n >= 6 else False
        if ratio >= 1.2 and up5:
            score += 15
            reasons.append("5 日均量为 20 日均量的 %.1f 倍，量价齐升" % ratio)
        elif ratio >= 1.0:
            score += 9
            reasons.append("量能温和（量比 %.2f）" % ratio)
        elif ratio < 0.8:
            score += 3
            risks.append("量能萎缩至均量的 %.2f 倍" % ratio)
        else:
            score += 6

    # 位置 15
    hh = max(series["h"][-60:])
    if close >= hh * 0.97:
        score += 15
        reasons.append("接近 60 日高点，处于强势突破位")
    elif close >= hh * 0.9:
        score += 10
    else:
        score += 3
        risks.append("距 60 日高点还有 %.0f%% 空间" % ((hh / close - 1) * 100))

    # 稳定性 10（波动越小越好，且回撤温和）
    base = 10
    if a and close:
        vol_pct = a / close * 100
        if vol_pct > 5:
            base -= 5
            risks.append("ATR 波动率 %.1f%%，波动偏大" % vol_pct)
        elif vol_pct > 3:
            base -= 2
    drawdown = (max(series["h"][-20:]) - close) / close * 100 if close else 0
    if drawdown > 8:
        base -= 3
        risks.append("20 日内自高点回撤 %.1f%%" % drawdown)
    score += max(0, base)

    # 风险扣分
    if ma20 and (close / ma20 - 1) > 0.15:
        score -= 8
        risks.append("短线偏离 20 日线超过 15%，追高风险大")
    if r is not None and r > 82:
        score -= 8
    if n >= 21:
        chg20 = (close / series["c"][n - 21] - 1) * 100
        if chg20 > 40:
            score -= 5
            risks.append("20 日涨幅已达 %.0f%%，注意兑现" % chg20)

    score = max(0, min(100, round(score)))
    return score, reasons, risks


# ----------------------------- 计划 -----------------------------

def build_plan(series, klines, score, reasons, risks):
    n = len(series["c"])
    close = series["c"][n - 1]
    ma20 = series["ma20"][n - 1]
    ma60 = series["ma60"][n - 1]
    r = series["rsi"][n - 1]
    a = series["atr"][n - 1] or close * 0.02
    b_up, b_low = series["bollUp"][n - 1], series["bollLow"][n - 1]

    hs, ls = _pivots(series["h"], series["l"], n - 70, n, 3)
    res_levels = [x for x in hs if x > close]
    sup_levels = [x for x in ls if x < close]

    resistance = _cluster(res_levels, close, True)
    support = _cluster(sup_levels, close, False)

    if ma20 and ma20 < close:
        support = _cluster(list(support) + [ma20], close, False)
    if ma60 and ma60 < close:
        support = _cluster(list(support) + [ma60], close, False)
    if b_low and b_low < close:
        support = _cluster(list(support) + [b_low], close, False)
    if not support:
        support = [min(series["l"][-20:])]
    if b_up and b_up > close:
        resistance = _cluster(list(resistance) + [b_up], close, True)
    if not resistance:
        resistance = [max(series["h"][-20:])]

    support = [round(x, 2) for x in support[:3]]
    resistance = [round(x, 2) for x in resistance[:2]]

    # 趋势判断
    if ma20 and ma60:
        if close > ma20 > ma60:
            trend, trend_code = "多头趋势", "bull"
        elif close > ma20 and ma20 <= ma60:
            trend, trend_code = "反弹修复", "rebound"
        elif close < ma20 < ma60:
            trend, trend_code = "空头趋势", "bear"
        else:
            trend, trend_code = "震荡整理", "range"
    else:
        trend, trend_code = "数据不足", "range"

    atr_pct = a / close * 100
    stop_ma = (ma20 * 0.97) if ma20 else None
    stop_swing = min(series["l"][-20:]) * 0.995
    stop_atr = close - 2.0 * a
    stop_candidates = [x for x in [stop_ma, stop_swing, stop_atr] if x and x < close]
    stop = round(max(stop_candidates), 2) if stop_candidates else round(close * 0.92, 2)

    if trend_code == "bull":
        if close <= (ma20 or close) * 1.03:
            buy_zone = [round(max(ma20 or close, close * 0.97), 2), round(close * 1.005, 2)]
            action, action_code = "回踩 20 日线附近低吸", "buy_dip"
        elif close >= max(series["h"][-60:]) * 0.97:
            buy_zone = [round(max(close * 0.97, stop), 2), round(close * 1.01, 2)]
            action, action_code = "强势突破，突破位附近轻仓跟进", "buy_breakout"
        else:
            buy_zone = [round(close * 0.96, 2), round(close * 0.995, 2)]
            action, action_code = "等待回踩确认后介入", "wait_pullback"
    elif trend_code == "rebound":
        buy_zone = [round((ma60 or close) * 0.995, 2), round(close, 2)]
        action, action_code = "反弹中，站稳 60 日线再加大仓位", "wait_confirm"
    elif trend_code == "bear":
        buy_zone = None
        action, action_code = "空头趋势，不建议逆势买入", "avoid"
    else:
        buy_zone = [round(close * 0.95, 2), round(close * 1.01, 2)]
        action, action_code = "区间震荡，低吸高抛为主", "range"

    # 止损必须落在买区下方，避免出现「买入即止损」的矛盾区间
    if buy_zone and stop > buy_zone[0] * 0.995:
        stop = round(min(stop, buy_zone[0] * 0.98), 2)

    t_candidates = [x for x in resistance if x > close * 1.04]
    if t_candidates:
        t1 = t_candidates[0]
    else:
        t1 = close + max(1.5 * a, close * 0.05)
    t1 = round(max(t1, close * 1.04), 2)
    t2 = round(max(close + 3.0 * a, max(series["h"][-60:]), close * 1.12), 2)
    risk = close - stop
    rr = (t1 - close) / risk if risk > 0 else 0

    chg5 = (close / series["c"][n - 6] - 1) * 100 if n >= 6 else 0
    chg20 = (close / series["c"][n - 21] - 1) * 100 if n >= 21 else 0

    summary_bits = [
        "%s，近 5 日 %+.1f%%、近 20 日 %+.1f%%" % (trend, chg5, chg20),
        "现价 %.2f，20 日线 %.2f" % (close, ma20 if ma20 else 0),
    ]
    if r is not None:
        summary_bits.append("RSI %.0f" % r)
    if resistance:
        summary_bits.append("压力 %.2f" % resistance[0])
    if support:
        summary_bits.append("支撑 %.2f" % support[0])

    return {
        "trend": trend,
        "trendCode": trend_code,
        "score": score,
        "action": action,
        "actionCode": action_code,
        "buyZone": buy_zone,
        "stop": stop,
        "target1": round(t1, 2),
        "target2": t2,
        "support": support,
        "resistance": resistance,
        "reasons": reasons,
        "risks": risks,
        "rr": round(rr, 2),
        "atrPct": round(atr_pct, 2),
        "summary": "；".join(summary_bits),
    }


def build_analysis(meta, klines, quote=None):
    if len(klines) < 70:
        raise ValueError("历史数据不足，无法分析")
    series = build_series(klines)
    signals = build_signals(series)
    score, reasons, risks = evaluate(series, klines)
    plan = build_plan(series, klines, score, reasons, risks)
    return {
        "meta": meta,
        "quote": quote or {},
        "klines": klines,
        "series": series,
        "signals": signals,
        "plan": plan,
    }
