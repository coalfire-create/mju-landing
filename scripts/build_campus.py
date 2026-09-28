"""Build src/data/campus.json for the campus flight.

Which buildings belong to Myongji comes from the university's own campus map
(www.mju.ac.kr/campusMap/mjukr/{1,2}/artclList.do, saved as official-*.json).
Footprints come from OpenStreetMap (© OpenStreetMap contributors, ODbL; saved
as osm-*.json). An official building with no OSM footprint gets a generated
one, so every building on the official list appears. All other OSM buildings
are background only.
"""
import json, math, os

HERE = os.path.dirname(__file__)
M_PER_DEG_LAT = 110540
FLOOR = 3.6  # metres per storey
MATCH_M = 45  # max distance from an official point to an OSM footprint's edge

# Official entries that are not buildings.
NOT_BUILDINGS = ('운동장', '테니스', '승차장', '승강장', '주차장', '수위실', '야외음악당', '정문', '백마상', '온실', '유압실')

# Storeys where known (Yongin from github.com/Min-8542/campus-navi, 종합관 and
# 방목학술정보관 from the university's building descriptions).
FLOORS = {
    '종합관': 10, '방목학술정보관': 4,
    '제1공학관': 6, '학생회관': 5, '창조관': 8, '명진당': 6, '제5공학관': 5, '체육문화관': 4, '체육관': 3,
    '제2공학관': 8, '함박관': 5, '선수숙소': 2, '학군단': 2, '디자인조형센터': 5, '제4공학관': 5,
    '구조재료실험동': 1, '수리모형실습동': 1, '방목기념관': 3, '산학협력관': 5, '공동실험동': 3,
    '제3공학관': 5, '건축도시설계원': 5, '학생복지관': 4, '60주년채플관': 3, '차세대과학관': 5,
    '하이브리드': 1, '모형실험동': 1,
}

CAMPUSES = {
    'seoul': {
        'stops': [('정문', '정문'), ('MCC관', 'MCC'), ('종합관', '종합관'), ('학생회관', '학생회관'), ('방목학술정보관', '방목학술정보관')],
    },
    'yongin': {
        'stops': [('정문', '정문'), ('60주년 채플관', '60주년채플관'), ('창조예술관', '창조관'), ('백마상', '백마상'), ('명진당', '명진당'), ('함박관', '함박관')],
    },
}


def inside(pt, poly):
    lat, lon = pt
    c = False
    for i in range(len(poly)):
        (y1, x1), (y2, x2) = poly[i], poly[i - 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            c = not c
    return c


def rings(e):
    if e['type'] == 'way' and 'geometry' in e:
        return [[(p['lat'], p['lon']) for p in e['geometry']]]
    if e['type'] == 'relation':
        return [[(p['lat'], p['lon']) for p in m['geometry']] for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
    return []


def edge_dist(pt, ring, dist_m, m_lon):
    # Distance in metres from pt to the nearest edge of ring (flat-earth approximation).
    px, py = pt[1] * m_lon, pt[0] * M_PER_DEG_LAT
    best = float('inf')
    for (la1, lo1), (la2, lo2) in zip(ring, ring[1:] + ring[:1]):
        ax, ay, bx, by = lo1 * m_lon, la1 * M_PER_DEG_LAT, lo2 * m_lon, la2 * M_PER_DEG_LAT
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
    return best


def centroid(ring):
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


# Display names where the campus map's own label reads awkwardly.
RENAME = {'창조관 예술관': '창조예술관', 'MCC': 'MCC관'}


def clean(name):
    # 생활관(명덕관) -> 명덕관, 생활관(제3학생기숙사(1동)) -> 제3학생기숙사 1동
    if name.startswith('생활관(') and len(name) > 5:
        inner = name[4:-1].replace('(', ' ').replace(')', '')
        if inner != '인문':
            return inner
    base = name.split('(')[0].strip()
    return RENAME.get(base, base)


def build(key, cfg):
    osm = json.load(open(os.path.join(HERE, f'osm-{key}.json')))['elements']
    official = [
        {'name': e['artclNm'].strip(), 'lat': float(e['latitude']), 'lon': float(e['longitude'])}
        for e in json.load(open(os.path.join(HERE, f'official-{key}.json')))
    ]
    lat0 = sum(o['lat'] for o in official) / len(official)
    lon0 = sum(o['lon'] for o in official) / len(official)
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    to_xz = lambda lat, lon: [round((lon - lon0) * m_lon, 1), round(-(lat - lat0) * M_PER_DEG_LAT, 1)]
    dist_m = lambda a, b: math.hypot((a[0] - b[0]) * M_PER_DEG_LAT, (a[1] - b[1]) * m_lon)
    lats = [o['lat'] for o in official]
    lons = [o['lon'] for o in official]
    pad = 0.0035  # ~350 m of neighbourhood around the campus
    in_box = lambda lat, lon: min(lats) - pad < lat < max(lats) + pad and min(lons) - pad < lon < max(lons) + pad

    buildings = []
    for e in osm:
        t = e.get('tags', {})
        if 'building' not in t:
            continue
        for ring in rings(e):
            c = centroid(ring)
            if in_box(*c):
                levels = t.get('building:levels')
                try:
                    h = float(levels) * FLOOR if levels else None
                except ValueError:
                    h = None
                buildings.append({'ring': ring, 'c': c, 'h': h, 'name': None})

    # Attach official buildings to OSM footprints, best matches first: a point
    # inside a footprint beats proximity, and each footprint is used once.
    # Anything left unmatched gets a generated footprint.
    targets = [o for o in official if not any(k in o['name'] for k in NOT_BUILDINGS)]
    pairs = []
    for oi, o in enumerate(targets):
        pt = (o['lat'], o['lon'])
        for bi, b in enumerate(buildings):
            if dist_m(pt, b['c']) < 250:
                d = 0 if inside(pt, b['ring']) else edge_dist(pt, b['ring'], dist_m, m_lon)
                pairs.append((0 if d == 0 else 1, d, oi, bi))
    pairs.sort()
    match = {}
    used = set()
    for kind, d, oi, bi in pairs:
        if oi in match or bi in used or (kind and d > MATCH_M):
            continue
        match[oi] = bi
        used.add(bi)
    generated = []
    for oi, o in enumerate(targets):
        pt = (o['lat'], o['lon'])
        if oi in match:
            hit = buildings[match[oi]]
        elif (host := next((buildings[bi] for bi in used if inside(pt, buildings[bi]['ring'])), None)):
            # Connected buildings drawn as one footprint in OSM share it.
            host['name'] += ' · ' + clean(o['name'])
            continue
        else:
            dlat, dlon = 11 / M_PER_DEG_LAT, 18 / m_lon  # 36 m x 22 m
            hit = {'ring': [(pt[0] - dlat, pt[1] - dlon), (pt[0] - dlat, pt[1] + dlon), (pt[0] + dlat, pt[1] + dlon), (pt[0] + dlat, pt[1] - dlon)], 'c': pt, 'h': None}
            buildings.append(hit)
            generated.append(o['name'])
        hit['name'] = clean(o['name'])
        floors = next((f for k, f in FLOORS.items() if k in o['name']), None)
        if floors:
            hit['h'] = floors * FLOOR

    stops = []
    for ko, key_ in cfg['stops']:
        o = next(o for o in official if key_ in o['name'])
        idx = next((i for i, b in enumerate(buildings) if b['name'] and clean(o['name']) in b['name']), None)
        stops.append({'ko': ko, 'at': to_xz(o['lat'], o['lon']), 'b': idx})

    paths = []
    for e in osm:
        t = e.get('tags', {})
        if t.get('highway') and 'geometry' in e:
            pts = [to_xz(p['lat'], p['lon']) for p in e['geometry'] if in_box(p['lat'], p['lon'])]
            if len(pts) > 1:
                paths.append(pts)

    height = lambda b: round(b['h'], 1) if b['h'] else (16.0 if b['name'] else 12.0)
    campus = [b for b in buildings if b['name']]
    print(key, 'official buildings', len(campus), 'generated', generated)
    return {
        'origin': [round(lat0, 6), round(lon0, 6)],
        'buildings': [
            {'p': [to_xz(*p) for p in b['ring']], 'h': height(b), 'c': 1 if b['name'] else 0, **({'n': b['name']} if b['name'] else {})}
            for b in buildings
        ],
        'paths': paths,
        'stops': stops,
    }


out = {k: build(k, v) for k, v in CAMPUSES.items()}
path = os.path.join(HERE, '..', 'src', 'data', 'campus.json')
json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
for k, v in out.items():
    print(k, 'total', len(v['buildings']), 'stops', [(s['ko'], s['b']) for s in v['stops']])
print('bytes', os.path.getsize(path))
