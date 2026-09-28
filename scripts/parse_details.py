"""Summarise official-details.json (fetched from the university campus map's
artclDetailView.do) into a short sign blurb, official code and storey count
per building."""
import json, re, collections

FACILITY = ['학생식당', '식당', '도서관', '열람실', '박물관', '강당', '공연장', '채플', '총장실', '체육관', '수영장',
            '헬스', '카페', '편의점', '서점', '은행', '보건', '기숙사', '입학', '전시', '스튜디오', '실험실', '공연']


def summarise(detail):
    rows = [r for r in detail[1:] if isinstance(r, dict)]
    text = '\n'.join((r.get('cn') or '') for r in rows)
    codes = collections.Counter(m[:-3] for m in re.findall(r'\b([SY]\d{4,5})', text))
    code = codes.most_common(1)[0][0] if codes else None
    above = [int(m) for r in rows if r.get('floorType') == '지상' for m in re.findall(r'(\d+)층', r.get('floor', ''))]
    below = [int(m) for r in rows if r.get('floorType') == '지하' for m in re.findall(r'(\d+)층', r.get('floor', ''))]
    items = []
    for line in re.split(r'[\n●,]', text):
        line = re.sub(r'\(?[SY]\d{3,6}[-~\d, ]*\)?', '', line)
        line = re.sub(r'^\d+(-\d+)?\s*', '', line.strip(' \t\r·')).strip(' \t\r·')
        if 2 <= len(line) <= 18 and line not in items:
            items.append(line)
    units = []
    for it in items:
        m = re.search(r'([가-힣A-Z]+(?:대학|학과|학부|전공|대학원))', it)
        if m and len(m.group(1)) >= 4 and m.group(1) not in units and not m.group(1).startswith(('특수', '일반')):
            units.append(m.group(1))
    facilities = [it for it in items if any(k in it for k in FACILITY)]
    picks = (units[:3] or []) + [f for f in facilities if f not in units][: max(0, 3 - len(units[:3]))]
    return {
        'code': code,
        'floors': max(above) if above else None,
        'basement': max(below) if below else 0,
        'note': ' · '.join(picks[:3]),
    }


if __name__ == '__main__':
    d = json.load(open('official-details.json'))
    for v in d.values():
        if isinstance(v['detail'], list) and len(v['detail']) > 1:
            print(v['campus'][0], v['name'], summarise(v['detail']))
