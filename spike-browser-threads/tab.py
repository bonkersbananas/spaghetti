import re,collections
rows={}
for l in open('/tmp/eng/results.jsonl'):
    if not l.startswith('{"which"'): continue
    m=re.search(r'"which":"(\w+)".*?"kind":"(\w+)","engine":"(\w+)"(?:,"variant":"(\w+)")?(?:,"wasm":"[^"]*")?(?:,"threads":(\d+))?',l)
    ms=[int(x) for x in re.findall(r'"ms":(\d+)',l)]
    pk=int(re.search(r'"peakGrowthMB":(\d+)',l).group(1)); mod=re.search(r'"models":\["[^"]*/([^"/]*)"',l).group(1)
    rows[(m.group(1),m.group(2),mod,m.group(3),m.group(5) or '0')]=(ms,pk)
names={'benchy-placed.stl':'Benchy','Stanford_Bunny.stl':'Bunny','ksr_fdmtest_v4.stl':'FDM test','b-1.stl':'4 Benchies'}
for kind,es,em in (('orca','st4','mt251'),('rs','rsst','rs')):
  print('##',kind)
  for b in ('chromium','webkit'):
    for mod,n in names.items():
      st=rows[(b,kind,mod,es,'0')]
      line=[b,n,f"ST {st[0][0]/1000:.1f}s/{st[0][-1]/1000:.1f}s"]
      for t in ('1','2','4'):
        r=rows.get((b,kind,mod,em,t))
        if r: line.append(f"T{t} {r[0][0]/1000:.1f}/{r[0][-1]/1000:.1f} => {st[0][0]/r[0][0]:.2f}x/{st[0][-1]/r[0][-1]:.2f}x")
      print(' | '.join(line))
