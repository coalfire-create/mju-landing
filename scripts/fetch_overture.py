"""Fetch building footprints around the Yongin campus from Overture Maps
(OSM + Microsoft ML footprints, ODbL/CDLA) into overture-yongin.json."""
import duckdb, json
REL = 's3://overturemaps-us-west-2/release/2026-09-23.1/theme=buildings/type=building/*'
BOX = (127.1770, 37.2160, 127.1940, 37.2265)  # xmin, ymin, xmax, ymax
con = duckdb.connect()
con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
rows = con.sql(f"""
  SELECT id, sources[1].dataset AS src, height, num_floors, ST_AsGeoJSON(geometry) AS g
  FROM read_parquet('{REL}', hive_partitioning=1)
  WHERE bbox.xmin > {BOX[0]} AND bbox.xmax < {BOX[2]} AND bbox.ymin > {BOX[1]} AND bbox.ymax < {BOX[3]}
""").fetchall()
out = [{'id': r[0], 'src': r[1], 'height': r[2], 'floors': r[3], 'geom': json.loads(r[4])} for r in rows]
json.dump(out, open('overture-yongin.json', 'w'))
from collections import Counter
print(len(out), Counter(o['src'] for o in out))
