"""生成 PWA 图标（纯 Python，不需要 Pillow）。

输出：web/icons/icon-192.png、icon-512.png
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "icons")
os.makedirs(OUT_DIR, exist_ok=True)


def make_png(width, height, pixels):
    """pixels: list of list of (R,G,B,A)"""
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter: None
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        chunk_len = struct.pack(">I", len(data))
        chunk_type = tag.encode("ascii")
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xffffffff)
        return chunk_len + chunk_type + data + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return signature + chunk("IHDR", ihdr) + chunk("IDAT", compressed) + chunk("IEND", b"")


def lerp(a, b, t):
    return a + (b - a) * t


def grad_point(px, py, w, h):
    """径向渐变：从中心 (0.5,0.5) 向外 radius 1.0，中心蓝 (77,141,255) 边缘紫 (138,91,255)"""
    cx, cy = 0.5, 0.5
    dx = (px + 0.5) / w - cx
    dy = (py + 0.5) / h - cy
    d = (dx * dx + dy * dy) ** 0.5 * 1.414  # 对角线归一化
    t = min(1.0, max(0.0, d))
    r = int(lerp(77, 138, t))
    g = int(lerp(141, 91, t))
    b = int(lerp(255, 255, t))
    return r, g, b


def draw(size, path):
    W = H = size
    radius = int(size * 0.19)  # 圆角
    bar_w = max(3, int(size * 0.014))
    # 折线点（相对比例），不同尺寸适配
    pts_ratio = [(0.23, 0.66), (0.40, 0.50), (0.50, 0.58), (0.66, 0.35), (0.78, 0.45)]
    pts = [(int(x * W), int(y * H)) for x, y in pts_ratio]

    # 圆节点
    node_r = max(3, int(size * 0.027))
    # 文字（"智"）用纯色块近似，这里不做，保持图标简洁

    pixels = []
    for py in range(H):
        row = []
        for px in range(W):
            # 圆角
            inside = True
            if px < radius and py < radius:
                inside = (px - radius) ** 2 + (py - radius) ** 2 <= radius ** 2
            elif px >= W - radius and py < radius:
                inside = (px - W + radius + 1) ** 2 + (py - radius) ** 2 <= radius ** 2
            elif px < radius and py >= H - radius:
                inside = (px - radius) ** 2 + (py - H + radius + 1) ** 2 <= radius ** 2
            elif px >= W - radius and py >= H - radius:
                inside = (px - W + radius + 1) ** 2 + (py - H + radius + 1) ** 2 <= radius ** 2

            if not inside:
                row.append((0, 0, 0, 0))
                continue

            # 折线（线段判断）
            on_bar = False
            for i in range(len(pts) - 1):
                x1, y1 = pts[i]
                x2, y2 = pts[i + 1]
                dist = point_to_segment_dist(px, py, x1, y1, x2, y2)
                if dist < bar_w:
                    on_bar = True
                    break

            # 圆节点
            node_color = None
            for i, (x, y) in enumerate(pts):
                dist = ((px - x) ** 2 + (py - y) ** 2) ** 0.5
                if dist < node_r:
                    node_color = (245, 185, 66) if i >= 3 else (77, 141, 255)
                    break

            if node_color:
                row.append(node_color + (255,))
            elif on_bar:
                row.append((140, 170, 255, 255))
            else:
                row.append((10, 14, 23, 255))
        pixels.append(row)

    png = make_png(W, H, pixels)
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, len(png), "bytes")


def point_to_segment_dist(px, py, x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0, min(1, t))
    cx = x1 + t * dx
    cy = y1 + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


if __name__ == "__main__":
    draw(192, os.path.join(OUT_DIR, "icon-192.png"))
    draw(512, os.path.join(OUT_DIR, "icon-512.png"))
    print("done")
