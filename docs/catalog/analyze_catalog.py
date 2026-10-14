#!/usr/bin/env python3
"""Alias hygiene report for ingredients.csv (collisions, shadows, empties). Run after build_catalog.py."""
import csv,collections,os
H=os.path.dirname(os.path.abspath(__file__))
rows=list(csv.DictReader(open(os.path.join(H,'ingredients.csv'),encoding='utf8')))
alias=collections.defaultdict(list)
for r in rows:
    for a in r['aliases'].split('|'):
        if a: alias[a.lower()].append(r['canonical_name'])
names={r['canonical_name'].lower():r['canonical_name'] for r in rows}
coll={a:sorted(set(v)) for a,v in alias.items() if len(set(v))>1}
shadow={a:(sorted(set(v)),names[a]) for a,v in alias.items() if a in names and names[a] not in v}
noalias=[r['canonical_name'] for r in rows if not r['aliases']]
o=['# Alias hygiene report (generated)','',f'{len(rows)} ingredients. Founder decisions are in `decisions.md`.','',
f'## Aliases claimed by more than one ingredient ({len(coll)})','Kept in both places by founder decision; the importer must ask the user (or use context) when it meets one of these.','',
'| Alias | Claimed by |','|---|---|']
o+= [f'| {a} | {"; ".join(v)} |' for a,v in sorted(coll.items())]
o+=['',f'## Alias equal to another ingredient\'s canonical name ({len(shadow)})','','| Alias | Listed under | Is also the canonical name of |','|---|---|---|']
o+= [f'| {a} | {"; ".join(v)} | {n} |' for a,(v,n) in sorted(shadow.items())]
o+=['',f'## Ingredients without aliases ({len(noalias)})','Accepted by founder; aliases are added as real imports reveal them.']
open(os.path.join(H,'anomalies.md'),'w',encoding='utf8').write('\n'.join(o)+'\n')
print(len(coll),len(shadow),len(noalias))
