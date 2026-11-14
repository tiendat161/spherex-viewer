import csv, sys, time, json, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
BASE = "https://irsa.ipac.caltech.edu/"
def urls(name, ra, dec, size, n):
    rows = list(csv.DictReader(open(f".cache/{name}.csv")))
    step = max(1, len(rows)//n)
    return [f"{BASE}{r['uri']}?center={ra},{dec}&size={size}" for r in rows[::step][:n]]
def fetch(u):
    t = time.time()
    try:
        b = urllib.request.urlopen(u, timeout=300).read()
        return (time.time()-t, len(b), 200)
    except urllib.error.HTTPError as e:
        return (time.time()-t, 0, e.code)
    except Exception as e:
        return (time.time()-t, 0, type(e).__name__)
if __name__ == "__main__":
    name, ra, dec, size, n, par = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), int(sys.argv[6])
    us = urls(name, ra, dec, size, n)
    t = time.time()
    with ThreadPoolExecutor(par) as ex: res = list(ex.map(fetch, us))
    wall = time.time()-t
    print(json.dumps({"target": name, "size": size, "n": len(us), "parallel": par, "wall_s": round(wall,2),
      "per_s": [round(r[0],2) for r in res], "MB": [round(r[1]/1e6,3) for r in res], "status": [r[2] for r in res], "sample": us[0]}))
