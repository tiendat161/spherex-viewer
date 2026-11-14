import math
# WISE 0855 proper motion: Luhman & Esplin 2016 as quoted by a secondary compilation (UNVERIFIED, not read from paper)
pmra, pmdec = -8.188, 0.680  # arcsec/yr (pmra includes cos dec)
mjd0, mjd1 = 60800.700028, 61174.287218  # first/last WISE0855 SPHEREx plane (spike/tap_wise.log)
dt = (mjd1-mjd0)/365.25
print(f"window {mjd1-mjd0:.1f} d = {dt:.3f} yr")
print(f"motion over window: dRA*cosD={pmra*dt:.2f}\"  dDec={pmdec*dt:.2f}\"  total={math.hypot(pmra,pmdec)*dt:.2f}\"")
print(f"total rate {math.hypot(pmra,pmdec):.3f}\"/yr; SPHEREx pixel ~6.2\" (36\"/6px from size=0.01 cutout)")
mid=(mjd0+mjd1)/2; yr=2000+(mid-51544.5)/365.25
print(f"window midpoint year {yr:.2f}")
for label,ep in [("J2000.0",2000.0),("WISE ~2010.5",2010.5),("Gaia 2016.0",2016.0)]:
    d=(yr-ep); print(f"if challenge coords are epoch {label}: offset at SPHEREx epoch = {math.hypot(pmra,pmdec)*d:.0f}\" ({d:.1f} yr)")
# Barnard: Gaia DR3 pm (mas/yr) from gea.esac.esa.int, epoch 2016.0
b=math.hypot(-801.55,10362.39)/1000
print(f"Barnard total pm {b:.3f}\"/yr -> {b*dt:.1f}\" over the same window; offset from 2016.0 pos at 2025.8: {b*(yr-2016):.0f}\"")
