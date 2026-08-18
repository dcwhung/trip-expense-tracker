import zlib, struct, math

BG = (15, 61, 46)      # deep green #0F3D2E
FG = (255, 255, 255)


def bezier(p0, p1, p2, p3, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0]
        y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
        pts.append((x, y))
    return pts


# Paths in a unit box: x,y in 0..1, y pointing down. Cap height = 1.
S_CURVES = [
    ((0.93, 0.20), (0.84, 0.01), (0.18, 0.00), (0.09, 0.25)),
    ((0.09, 0.25), (0.01, 0.47), (0.99, 0.54), (0.91, 0.76)),
    ((0.91, 0.76), (0.83, 0.99), (0.17, 1.00), (0.07, 0.79)),
]


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    L = vx*vx + vy*vy
    t = 0.0 if L == 0 else max(0.0, min(1.0, (wx*vx + wy*vy) / L))
    dx, dy = wx - t*vx, wy - t*vy
    return math.sqrt(dx*dx + dy*dy)


def render(size, pad_ratio=0.0):
    px = [[BG] * size for _ in range(size)]

    cap = size * (1.0 - 2 * pad_ratio) * 0.42     # cap height in device px
    stroke = cap * 0.17
    half = stroke / 2.0
    t_w, s_w, gap = cap * 0.70, cap * 0.62, cap * 0.16
    total_w = t_w + gap + s_w
    ox = (size - total_w) / 2.0
    oy = (size - cap) / 2.0

    segs = []
    # T: top bar + stem, inset by half-stroke so the ink stays inside the cap box
    tx = ox
    segs.append((tx + half, oy + half, tx + t_w - half, oy + half))
    segs.append((tx + t_w/2, oy + half, tx + t_w/2, oy + cap - half))
    # S: flattened beziers, inset the same way
    sx = ox + t_w + gap
    sw, sh = s_w - stroke, cap - stroke
    for c in S_CURVES:
        pts = bezier(*c)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            segs.append((sx + half + a[0]*sw, oy + half + a[1]*sh,
                         sx + half + b[0]*sw, oy + half + b[1]*sh))

    x0 = max(0, int(ox - stroke) - 2)
    x1 = min(size, int(ox + total_w + stroke) + 2)
    y0 = max(0, int(oy - stroke) - 2)
    y1 = min(size, int(oy + cap + stroke) + 2)

    for y in range(y0, y1):
        cy = y + 0.5
        row = px[y]
        for x in range(x0, x1):
            cx = x + 0.5
            d = 1e9
            for (ax, ay, bx, by) in segs:
                if abs(cx - ax) - half > d and abs(cx - bx) - half > d:
                    continue
                dd = seg_dist(cx, cy, ax, ay, bx, by)
                if dd < d:
                    d = dd
                    if d <= half - 1:
                        break
            a = (half + 0.5 - d)
            if a <= 0:
                continue
            if a >= 1:
                row[x] = FG
            else:
                row[x] = tuple(int(round(BG[i] + (FG[i] - BG[i]) * a)) for i in range(3))
    return px


def downsample(src, factor):
    n = len(src) // factor
    out = [[BG] * n for _ in range(n)]
    inv = 1.0 / (factor * factor)
    for y in range(n):
        for x in range(n):
            r = g = b = 0
            for dy in range(factor):
                srow = src[y*factor + dy]
                for dx in range(factor):
                    p = srow[x*factor + dx]
                    r += p[0]; g += p[1]; b += p[2]
            out[y][x] = (int(r*inv), int(g*inv), int(b*inv))
    return out


def write_png(path, px):
    size = len(px)
    raw = b''.join(b'\x00' + b''.join(struct.pack('BBB', *p) for p in row) for row in px)

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


big = render(1440, 0.0)
write_png('icons/icon-512.png', downsample(big, 1440 // 512) if 1440 % 512 == 0 else render(512, 0.0))
write_png('icons/icon-512.png', render(512, 0.0))
write_png('icons/icon-192.png', downsample(render(576, 0.0), 3))
write_png('icons/icon-180.png', downsample(render(540, 0.0), 3))
write_png('icons/icon-512-maskable.png', render(512, 0.16))
for n in ('icon-180', 'icon-192', 'icon-512', 'icon-512-maskable'):
    print('wrote icons/%s.png' % n)
