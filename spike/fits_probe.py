import sys
d=open(sys.argv[1],'rb').read(); i=0; n=0
while i < len(d):
    hdr={}; start=i
    while True:
        blk=d[i:i+2880]; i+=2880
        done=False
        for k in range(0,2880,80):
            c=blk[k:k+80].decode('latin1')
            if c.startswith('END'): done=True;break
            if '=' in c[:10]: hdr[c[:8].strip()]=c[10:].split('/')[0].strip()
        if done: break
    ax=[int(hdr.get(f'NAXIS{j}',0)) for j in range(1,int(hdr['NAXIS'])+1)]
    bp=abs(int(hdr['BITPIX']))//8; sz=bp*eval('*'.join(map(str,ax))) if ax else 0
    print(n, hdr.get('EXTNAME','PRIMARY'), ax, f'{sz/1e6:.3f}MB')
    i+= (sz+2879)//2880*2880; n+=1
