#!/usr/bin/env python3
"""Génère les icônes PNG de l'extension Arena FS (dossier orange + éclair blanc).

Aucune dépendance externe : les PNG sont écrits à la main (zlib + struct).
Usage : python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "arena-extension", "icons")

# Éclair blanc (polygone simple, coordonnées normalisées 0..1)
BOLT = [(0.60, 0.32), (0.42, 0.58), (0.52, 0.58), (0.44, 0.82), (0.66, 0.52), (0.54, 0.52)]


def sd_rrect(px, py, cx, cy, hw, hh, r):
    """Distance signée d'un rectangle arrondi (négatif = dedans)."""
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ox, oy = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ox, oy) + min(max(qx, qy), 0.0) - r


def in_poly(u, v):
    inside = False
    n = len(BOLT)
    for i in range(n):
        x1, y1 = BOLT[i]
        x2, y2 = BOLT[(i + 1) % n]
        if (y1 > v) != (y2 > v):
            xint = x1 + (v - y1) * (x2 - x1) / (y2 - y1)
            if xint > u:
                inside = not inside
    return inside


def lerp(a, b, t):
    return a + (b - a) * t


def over(dst, src):
    """Compositing alpha standard (couleurs non prémultipliées, 0..1)."""
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    a = sa + da * (1.0 - sa)
    if a <= 0.0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        (sr * sa + dr * da * (1.0 - sa)) / a,
        (sg * sa + dg * da * (1.0 - sa)) / a,
        (sb * sa + db * da * (1.0 - sa)) / a,
        a,
    )


def sample(u, v):
    col = (0.0, 0.0, 0.0, 0.0)
    # Languette du dossier (derrière)
    if sd_rrect(u, v, 0.28, 0.26, 0.18, 0.10, 0.05) < 0:
        col = over(col, (0.85, 0.47, 0.02, 1.0))
    # Corps du dossier avec dégradé vertical ambre -> orange
    if sd_rrect(u, v, 0.50, 0.56, 0.40, 0.30, 0.07) < 0:
        t = max(0.0, min(1.0, (v - 0.26) / 0.60))
        col = over(col, (lerp(0.96, 0.92, t), lerp(0.62, 0.35, t), lerp(0.04, 0.05, t), 1.0))
    # Éclair blanc
    if in_poly(u, v):
        col = over(col, (1.0, 1.0, 1.0, 0.96))
    return col


def render(size):
    ss = 3  # suréchantillonnage 3x3 pour l'anticrénelage
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = (0.0, 0.0, 0.0, 0.0)
            for sy in range(ss):
                for sx in range(ss):
                    u = (x + (sx + 0.5) / ss) / size
                    v = (y + (sy + 0.5) / ss) / size
                    acc = over(acc, sample(u, v))
            r, g, b, a = acc
            row += bytes((round(r * 255), round(g * 255), round(b * 255), round(a * 255)))
        rows.append(bytes(row))
    raw = b"".join(b"\x00" + r for r in rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(render(size))
        print("écrit :", path)


if __name__ == "__main__":
    main()
