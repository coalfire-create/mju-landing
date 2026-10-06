"""Build the real-looking world around both Myongji campuses (no paid APIs).

For each campus (seoul, yongin), around its origin in src/data/campus.json:
- public/terrain-<key>.png: heightmap from AWS Open Data Terrain Tiles
  (Terrarium, z15) on a 5 m grid; 16-bit height in R (high) and G (low), in
  centimetres above HMIN.
- src/data/world.json: OSM (© OpenStreetMap contributors, ODbL) land areas by
  class, trees (mapped trees + tree rows + forest scatter + wooded hillsides),
  and each building's base height and style.

Scene frame matches campus.json: metres around each campus origin, x east,
z south, y up with y = 0 at the ground height of the origin.
Caches downloads in scripts/cache/.
"""
import io, json, math, os, random, re, sys, time, urllib.parse, urllib.request
from PIL import Image

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, '..')
CACHE = os.path.join(HERE, 'cache')
os.makedirs(CACHE, exist_ok=True)
M_LAT = 110540
Z = 15
R = 1000  # half-size of each terrain patch, metres
STEP = 5
camp = json.load(open(os.path.join(ROOT, 'src/data/campus.json')))


def fetch(url, path, timeout=90):
    if not os.path.exists(path):
        for i in range(6):
            try:
                data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'mju-landing/1.0'}), timeout=timeout).read()
                open(path, 'wb').write(data)
                break
            except Exception as e:
                print('retry', e, file=sys.stderr)
                time.sleep(8)
    return open(path, 'rb').read()


def tile_xy(lat, lon):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def simplify(pts, tol=1.2):
    if len(pts) < 4:
        return pts
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz) or 1
    far, idx = 0, 0
    for i, p in enumerate(pts[1:-1], 1):
        d = abs(dz * (p[0] - a[0]) - dx * (p[1] - a[1])) / L
        if d > far:
            far, idx = d, i
    if far < tol:
        return [a, b]
    return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def inside(pt, ring):
    x, z = pt
    c = False
    for (x1, z1), (x2, z2) in zip(ring, ring[1:] + ring[:1]):
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            c = not c
    return c


CLASS = {'grass': 'grass', 'park': 'grass', 'garden': 'grass', 'recreation_ground': 'grass', 'grassland': 'grass', 'allotments': 'grass',
         'cemetery': 'grass', 'playground': 'grass', 'meadow': 'grass', 'farmland': 'grass', 'wood': 'wood', 'forest': 'wood', 'scrub': 'wood',
         'heath': 'wood', 'orchard': 'wood', 'pitch': 'pitch', 'track': 'track', 'stadium': 'pitch', 'sports_centre': 'pitch', 'parking': 'parking',
         'water': 'water', 'reservoir': 'water', 'bare_rock': 'rock', 'construction': 'dirt', 'brownfield': 'dirt', 'residential': 'urban',
         'retail': 'urban', 'commercial': 'urban', 'education': 'campus', 'university': 'campus', 'religious': 'urban', 'military': 'urban',
         'industrial': 'urban', 'railway': 'urban'}
GLASS = {'MCC관', '미래관', '차세대과학관', '방목학술정보관', '산학협력관', '하이브리드 구조실험센터', '디자인조형센터'}
DORM = re.compile(r'생활관|기숙사|명덕관|명현관|숙소')
out = {}

for key in ('seoul', 'yongin'):
    c = camp[key]
    lat0, lon0 = c['origin']
    m_lon = M_LAT * math.cos(math.radians(lat0))
    to_xz = lambda lat, lon: ((lon - lon0) * m_lon, -(lat - lat0) * M_LAT)
    to_ll = lambda x, z: (lat0 - z / M_LAT, lon0 + x / m_lon)
    S, N = lat0 - (R + 200) / M_LAT, lat0 + (R + 200) / M_LAT
    W, E = lon0 - (R + 200) / m_lon, lon0 + (R + 200) / m_lon

    # --- elevation ---
    fx0, fy1 = tile_xy(S, W)
    fx1, fy0 = tile_xy(N, E)
    x0, x1, y0, y1 = int(fx0), int(fx1), int(fy0), int(fy1)
    dem = Image.new('RGB', ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            raw = fetch(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png', os.path.join(CACHE, f'{tx}-{ty}.png'))
            dem.paste(Image.open(io.BytesIO(raw)).convert('RGB'), ((tx - x0) * 256, (ty - y0) * 256))
    px = dem.load()

    def elev(lat, lon):
        fx, fy = tile_xy(lat, lon)
        fx = (fx - x0) * 256
        fy = (fy - y0) * 256
        ix, iy = int(fx), int(fy)
        tx, ty = fx - ix, fy - iy
        h = lambda x, y: (lambda r, g, b: r * 256 + g + b / 256 - 32768)(*px[x, y])
        a = h(ix, iy) * (1 - tx) + h(ix + 1, iy) * tx
        b = h(ix, iy + 1) * (1 - tx) + h(ix + 1, iy + 1) * tx
        return a * (1 - ty) + b * ty

    E0 = elev(lat0, lon0)
    ground = lambda x, z: elev(*to_ll(x, z)) - E0
    G = 2 * R // STEP + 1
    hs = [[ground(-R + i * STEP, -R + j * STEP) for i in range(G)] for j in range(G)]
    HMIN = math.floor(min(min(r) for r in hs)) - 1
    img = Image.new('RGB', (G, G))
    for j in range(G):
        for i in range(G):
            v = max(0, min(65535, round((hs[j][i] - HMIN) * 100)))
            img.putpixel((i, j), (v >> 8, v & 255, 0))
    img.save(os.path.join(ROOT, f'public/terrain-{key}.png'))
    print(key, 'terrain', G, 'HMIN', HMIN, 'max', round(max(max(r) for r in hs), 1))

    # --- land cover ---
    B = f'{S},{W},{N},{E}'
    q = f'''[out:json][timeout:180];
(way["landuse"]({B}); relation["landuse"]({B});
 way["natural"~"wood|scrub|grassland|water|heath|bare_rock"]({B}); relation["natural"~"wood|scrub|water"]({B});
 way["leisure"~"park|pitch|garden|track|playground|stadium|sports_centre"]({B});
 way["amenity"~"parking|university"]({B});
 way["natural"="tree_row"]({B}); node["natural"="tree"]({B}););
out geom tags;'''
    land = json.loads(fetch('https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q), os.path.join(CACHE, f'land-{key}.json'), 240))['elements']
    areas, wood_polys, tree_pts = [], [], []
    for e in land:
        t = e.get('tags', {})
        if e['type'] == 'node' and t.get('natural') == 'tree':
            tree_pts.append((*to_xz(e['lat'], e['lon']), 1))
            continue
        if t.get('natural') == 'tree_row' and 'geometry' in e:
            pts = [to_xz(p['lat'], p['lon']) for p in e['geometry']]
            for (ax, az), (bx, bz) in zip(pts, pts[1:]):
                n = max(1, int(math.hypot(bx - ax, bz - az) / 7))
                tree_pts += [(ax + (bx - ax) * k / n, az + (bz - az) * k / n, 1) for k in range(n)]
            continue
        cls = CLASS.get(t.get('landuse') or t.get('natural') or t.get('leisure') or t.get('amenity'))
        if not cls:
            continue
        rings = [e['geometry']] if e['type'] == 'way' and 'geometry' in e else [m['geometry'] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        for ring in rings:
            pts = [to_xz(p['lat'], p['lon']) for p in ring]
            if not any(-R < x < R and -R < z < R for x, z in pts):
                continue
            mid = len(pts) // 2
            pts = simplify(pts[:mid + 1])[:-1] + simplify(pts[mid:])
            if len(pts) < 3:
                continue
            areas.append({'k': cls, 'p': [[round(x, 1), round(z, 1)] for x, z in pts]})
            if cls == 'wood':
                wood_polys.append(pts)
    order = ['urban', 'campus', 'dirt', 'grass', 'wood', 'parking', 'pitch', 'track', 'water', 'rock']
    areas.sort(key=lambda a: order.index(a['k']))

    rnd = random.Random(1948)
    # Road centrelines on a 10 m grid, to keep the forest off the streets.
    q = f'[out:json][timeout:180];way["highway"]({B});out geom tags;'
    road_cells = set()
    for e in json.loads(fetch('https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q), os.path.join(CACHE, f'roads-{key}.json'), 240))['elements']:
        if e.get('tags', {}).get('highway') in ('footway', 'path', 'steps', 'track') or 'geometry' not in e:
            continue
        pts = [to_xz(p['lat'], p['lon']) for p in e['geometry']]
        for (ax, az), (bx, bz) in zip(pts, pts[1:]):
            n = max(1, int(math.hypot(bx - ax, bz - az) / 5))
            for k in range(n + 1):
                road_cells.add((int((ax + (bx - ax) * k / n) // 10), int((az + (bz - az) * k / n) // 10)))
    near_road = lambda x, z: any((int(x // 10) + dx, int(z // 10) + dz) in road_cells for dx in (-1, 0, 1) for dz in (-1, 0, 1))
    foot = [b['p'] for b in c['buildings']]
    fbox = [(min(p[0] for p in f), max(p[0] for p in f), min(p[1] for p in f), max(p[1] for p in f)) for f in foot]
    on_building = lambda x, z: any(b[0] < x < b[1] and b[2] < z < b[3] and inside((x, z), f) for f, b in zip(foot, fbox))
    SP = 10
    for poly in wood_polys:
        xs = [p[0] for p in poly]
        zs = [p[1] for p in poly]
        for gx in range(int(max(min(xs), -R)) // SP * SP, int(min(max(xs), R)), SP):
            for gz in range(int(max(min(zs), -R)) // SP * SP, int(min(max(zs), R)), SP):
                x, z = gx + rnd.uniform(0, SP), gz + rnd.uniform(0, SP)
                if inside((x, z), poly) and not on_building(x, z):
                    tree_pts.append((x, z, 0))
    # Wooded slopes that OSM leaves bare. 자연캠퍼스 sits in a forested
    # mountain valley, so there any slope that isn't built on gets forest.
    open_ground = ('wood', 'grass', 'campus') if key == 'yongin' else ('wood', 'grass')
    nonwood = [a['p'] for a in areas if a['k'] not in open_ground]
    nbox = [(min(p[0] for p in f), max(p[0] for p in f), min(p[1] for p in f), max(p[1] for p in f)) for f in nonwood]
    HS = 10 if key == 'yongin' else 13
    SLOPE = (1.2, 1.5) if key == 'yongin' else (3.5, 2.5)
    hill = 0
    for gx in range(-R, R, HS):
        for gz in range(-R, R, HS):
            x, z = gx + rnd.uniform(0, HS), gz + rnd.uniform(0, HS)
            slope = abs(ground(x + 6, z) - ground(x - 6, z)) + abs(ground(x, z + 6) - ground(x, z - 6))
            if slope < SLOPE[0] + rnd.uniform(0, SLOPE[1]):
                continue
            if near_road(x, z) or on_building(x, z) or any(b[0] < x < b[1] and b[2] < z < b[3] and inside((x, z), f) for f, b in zip(nonwood, nbox)):
                continue
            tree_pts.append((x, z, 0))
            hill += 1
    trees = []
    for x, z, mapped in tree_pts:
        if -R < x < R and -R < z < R:
            trees += [round(x, 1), round(z, 1), round(ground(x, z), 1), round(rnd.uniform(0.75, 1.3) * (1.1 if mapped else 1.0), 2)]

    bases, styles = [], []
    for b in c['buildings']:
        bases.append(round(min(ground(x, z) for x, z in b['p']), 1))
        n = b.get('n', '')
        styles.append('t' if not b.get('c') else 'm' if n in GLASS else 'd' if DORM.search(n) else 'c')
    stops = [round(ground(*s['at']), 1) for s in c['stops']]
    # Streets and walks with a width class: w (wide road), r (road), p
    # (pedestrian street), f (foot path / steps).
    WIDTH = {'primary': 'w', 'secondary': 'w', 'tertiary': 'w', 'trunk': 'w', 'motorway': 'w', 'residential': 'r', 'unclassified': 'r',
             'service': 'r', 'living_street': 'r', 'pedestrian': 'p', 'footway': 'f', 'path': 'f', 'steps': 'f', 'cycleway': 'f', 'track': 'f'}
    q = f'[out:json][timeout:180];way["highway"]({B});out geom tags;'
    roads = json.loads(fetch('https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(q), os.path.join(CACHE, f'roads-{key}.json'), 240))['elements']
    paths = []
    for e in roads:
        k = WIDTH.get(e.get('tags', {}).get('highway'))
        if k and 'geometry' in e:
            pts = [[round(v, 1) for v in to_xz(p['lat'], p['lon'])] for p in e['geometry']]
            if any(-R < x < R and -R < z < R for x, z in pts):
                paths.append({'k': k, 'p': pts})
    out[key] = {'terrain': {'x0': -R, 'z0': -R, 'step': STEP, 'w': G, 'h': G, 'hmin': HMIN}, 'areas': areas, 'trees': trees,
                'bases': bases, 'styles': ''.join(styles), 'stopGround': stops, 'paths': paths}
    print(key, 'areas', len(areas), 'trees', len(trees) // 4, 'hill', hill, 'paths', len(paths))

json.dump(out, open(os.path.join(ROOT, 'src/data/world.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('world.json KB', os.path.getsize(os.path.join(ROOT, 'src/data/world.json')) // 1024)
