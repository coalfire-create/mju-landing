"""Turn OpenStreetMap extracts of both Myongji campuses into src/data/campus.json.

Inputs (fetched from the Overpass API, © OpenStreetMap contributors, ODbL):
  scripts/osm-seoul.json, scripts/osm-yongin.json
Yongin buildings carry no names in OSM, so they are matched by position to the
building coordinates published in github.com/Min-8542/campus-navi.
"""
import json, math, os

HERE = os.path.dirname(__file__)
M_PER_DEG_LAT = 110540
FLOOR = 3.6  # metres per storey

# Yongin building coordinates and floor counts from campus-navi (Y = 자연캠퍼스 numbering).
YONGIN_NAMED = {
    'Y1': ('학생회관', 37.22338, 127.18723, 5),
    'Y2': ('창조예술관', 37.22273, 127.18904, 8),
    'Y3': ('명진당', 37.22210, 127.18848, 6),
    'Y9': ('함박관', 37.22110, 127.18862, 5),
    'Y22': ('60주년 채플관', 37.22348, 127.18711, 3),
}

CAMPUSES = {
    'seoul': {
        # Main gate: centre of the pedestrian entrances on the south boundary (거북골로).
        'gate': (37.57880, 126.92265),
        'stops': [('정문', None), ('MCC관', 'S10'), ('종합관', 'S1'), ('학생회관', 'S2'), ('방목학술정보관', 'S9')],
    },
    'yongin': {
        # Main gate: where the access road (명지로) crosses the campus boundary.
        'gate': (37.2248126, 127.1877768),
        'stops': [('정문', None), ('60주년 채플관', 'Y22'), ('창조예술관', 'Y2'), ('명진당', 'Y3'), ('함박관', 'Y9')],
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


def centroid(ring):
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def build(key, cfg):
    d = json.load(open(os.path.join(HERE, f'osm-{key}.json')))
    els = d['elements']
    uni = next(e for e in els if e.get('tags', {}).get('amenity') == 'university')
    outline = rings(uni)[0]
    lat0, lon0 = centroid(outline)
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    to_xz = lambda lat, lon: [round((lon - lon0) * m_lon, 1), round(-(lat - lat0) * M_PER_DEG_LAT, 1)]
    lats = [p[0] for p in outline]
    lons = [p[1] for p in outline]
    pad = 0.0018  # ~200 m of neighbourhood around the campus
    in_box = lambda lat, lon: min(lats) - pad < lat < max(lats) + pad and min(lons) - pad < lon < max(lons) + pad

    buildings = []
    for e in els:
        t = e.get('tags', {})
        if 'building' not in t:
            continue
        for ring in rings(e):
            c = centroid(ring)
            if not in_box(*c):
                continue
            levels = t.get('building:levels')
            try:
                h = float(t['height']) if 'height' in t else float(levels) * FLOOR if levels else None
            except ValueError:
                h = None
            buildings.append({'ring': ring, 'c': c, 'name': t.get('name'), 'h': h, 'campus': inside(c, outline)})

    def nearest(lat, lon):
        best = min(buildings, key=lambda b: (0 if inside((lat, lon), b['ring']) else 1, math.dist((lat, lon), b['c'])))
        return buildings.index(best)

    # Names for Yongin come from campus-navi coordinates.
    if key == 'yongin':
        for code, (name, lat, lon, floors) in YONGIN_NAMED.items():
            b = buildings[nearest(lat, lon)]
            b['name'], b['h'] = name, floors * FLOOR

    stops = []
    for ko, code in cfg['stops']:
        if ko == '정문':
            stops.append({'ko': ko, 'at': to_xz(*cfg['gate']), 'b': None})
            continue
        idx = next(i for i, b in enumerate(buildings) if b['name'] == ko and b['campus'])
        b = buildings[idx]
        stops.append({'ko': ko, 'code': code, 'at': to_xz(*b['c']), 'b': idx})

    paths = []
    for e in els:
        t = e.get('tags', {})
        if t.get('highway') and 'geometry' in e and t['highway'] not in ('bus_stop',):
            pts = [to_xz(p['lat'], p['lon']) for p in e['geometry'] if in_box(p['lat'], p['lon'])]
            if len(pts) > 1:
                paths.append(pts)

    def height(b):
        if b['h']:
            return round(b['h'], 1)
        return 18.0 if b['campus'] else 12.0

    return {
        'origin': [round(lat0, 6), round(lon0, 6)],
        'outline': [to_xz(*p) for p in outline],
        'buildings': [{'p': [to_xz(*p) for p in b['ring']], 'h': height(b), 'c': 1 if b['campus'] else 0} for b in buildings],
        'paths': paths,
        'stops': stops,
    }


out = {k: build(k, v) for k, v in CAMPUSES.items()}
path = os.path.join(HERE, '..', 'src', 'data', 'campus.json')
json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
for k, v in out.items():
    print(k, 'buildings', len(v['buildings']), 'campus', sum(b['c'] for b in v['buildings']), 'paths', len(v['paths']), 'stops', [(s['ko'], s['at']) for s in v['stops']])
print('bytes', os.path.getsize(path))
