"""Where two G-codes put their support plastic: per object-layer height (Z_HEIGHT), mm³ of extrusion in the features given,
ours and Orca's side by side, grouped by STEP layers.  python3 -I bench/support_layers.py ours.gcode orca.gcode [STEP] [feature,...]"""
import sys,re,math,collections
def prof(path, feats=("Support",)):
    z=0.0;feat="";by=collections.defaultdict(float);area=2.405281875
    with open(path,errors='replace') as f:
        for l in f:
            if l.startswith(";Z:") or l.startswith("; Z_HEIGHT:") : 
                try: z=float(l.split(":")[1])
                except: pass
            elif l.startswith("; FEATURE: "): feat=l[11:].strip()
            elif l[:3] in("G1 ","G2 ","G3 "):
                c=l.split(";")[0]
                if feat in feats and "E" in c and ("X" in c or "Y" in c):
                    for w in c.split()[1:]:
                        if w[0]=="E":
                            e=float(w[1:])
                            if e>0: by[round(z,4)]+=e*area
    return by
feats=tuple(sys.argv[4].split(",")) if len(sys.argv)>4 else ("Support",)
a=prof(sys.argv[1],feats);b=prof(sys.argv[2],feats)
zs=sorted(set(a)|set(b))
step=int(sys.argv[3]) if len(sys.argv)>3 else 1
for i in range(0,len(zs),step):
    g=zs[i:i+step]
    x=sum(a.get(z,0) for z in g);y=sum(b.get(z,0) for z in g)
    print(f"{g[0]:6.2f} ours {x:8.1f} orca {y:8.1f} diff {x-y:+7.1f}")
