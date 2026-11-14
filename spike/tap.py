import time, urllib.parse, urllib.request, sys, csv, io, json
TARGETS = {
 "wise0855": (133.79513, -7.245147),  # 08h55m10.831s, -7d14m42.53s
 "barnard": None,
}
# 08h55m10.831s -> deg
ra = (8+55/60+10.831/3600)*15; dec = -(7+14/60+42.53/3600)
TARGETS["wise0855"] = (ra, dec)
URL = "https://irsa.ipac.caltech.edu/TAP/sync"
def q(ra, dec, n=3):
    adql = (f"SELECT p.planeid, p.time_bounds_lower, p.time_bounds_upper, p.energy_bandpassname, a.uri, a.contentlength "
            f"FROM spherex.plane p JOIN spherex.artifact a ON a.planeid=p.planeid "
            f"WHERE CONTAINS(POINT('ICRS',{ra},{dec}), p.poly)=1 ORDER BY p.time_bounds_lower")
    data = urllib.parse.urlencode({"QUERY": adql, "LANG": "ADQL", "FORMAT": "csv"}).encode()
    ts = []
    for _ in range(n):
        t = time.time(); body = urllib.request.urlopen(URL, data, timeout=300).read(); ts.append(time.time()-t)
    return body.decode(), ts
if __name__ == "__main__":
    name = sys.argv[1]
    if name == "barnard":
        ra, dec = float(sys.argv[2]), float(sys.argv[3])
    else:
        ra, dec = TARGETS[name]
    body, ts = q(ra, dec)
    open(f".cache/{name}.csv", "w").write(body)
    rows = list(csv.DictReader(io.StringIO(body)))
    print(json.dumps({"target": name, "ra": ra, "dec": dec, "rows": len(rows), "seconds": [round(t,2) for t in ts],
      "first": rows[0] if rows else None, "last": rows[-1] if rows else None}, indent=1))
