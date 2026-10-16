#!/usr/bin/env python3
"""Builds docs/catalog/{ingredients.csv,ingredients.md,conversions.csv,anomalies.md} from src/*.txt.
Run:  python3 -I docs/catalog/build_catalog.py"""
import csv, glob, os, re, collections
HERE = os.path.dirname(os.path.abspath(__file__))
APP_CAT = {
 'dal_pulse':'dal','whole_grain':'grain','rice':'grain','flour':'grain',
 'spice_whole':'spice','spice_ground':'spice','masala_blend':'spice',
 'salt_sugar':'dry_goods','oil':'oil','ghee_butter':'oil',
 'dairy_liquid':'dairy','dairy_solid':'dairy','curd':'dairy','egg':'eggs',
 'vegetable':'produce','leafy_herb':'produce','fruit':'produce','nut_seed':'dry_goods',
 'meat':'meat_fish','fish':'meat_fish','condiment_sauce':'condiment','paste':'condiment',
 'pickle_chutney':'condiment','bakery':'bakery','snack':'snacks','beverage':'beverages',
 'frozen':'frozen','baking_misc':'other'}
NEW_CATS = {'eggs','meat_fish','bakery','snacks','beverages'}
UNITS = {  # allowed units (first = default pantry unit)
 'dal_pulse':'g|kg|cup','whole_grain':'g|kg|cup','rice':'g|kg|cup','flour':'g|kg|cup',
 'spice_whole':'g|tsp|tbsp|piece','spice_ground':'g|tsp|tbsp','masala_blend':'g|tsp|tbsp|packet',
 'salt_sugar':'g|kg|tsp|tbsp|cup','oil':'ml|l|tbsp|tsp|cup|bottle|packet','ghee_butter':'g|kg|ml|tbsp|tsp',
 'dairy_liquid':'ml|l|cup|packet','dairy_solid':'g|kg|piece|packet','curd':'g|kg|ml|cup|tbsp',
 'egg':'piece|dozen','vegetable':'g|kg|piece','leafy_herb':'bunch|g|tbsp','fruit':'g|kg|piece|dozen',
 'nut_seed':'g|kg|cup|tbsp','meat':'g|kg|piece','fish':'g|kg|piece','condiment_sauce':'ml|g|tbsp|tsp|bottle|jar|packet',
 'paste':'g|tbsp|tsp|jar','pickle_chutney':'g|tbsp|tsp|jar|bottle','bakery':'piece|slice|pack|loaf|g',
 'snack':'packet|g|piece','beverage':'g|ml|l|cup|tsp|tbsp|packet|bottle','frozen':'g|kg|packet|piece',
 'baking_misc':'g|tsp|tbsp|packet'}
# (subcategory, unit) -> (base, amount)
CONV = {}
def sc(s,u,b,a): CONV[(s,u)]=(b,a)
for s in UNITS:
    sc(s,'g','g',1); sc(s,'kg','g',1000)
    sc(s,'ml','ml',1); sc(s,'l','ml',1000)
for s,v in {'dal_pulse':200,'whole_grain':180,'rice':185,'flour':120,'salt_sugar':200,'nut_seed':140}.items(): sc(s,'cup','g',v)
sc('oil','cup','ml',240); sc('dairy_liquid','cup','ml',240); sc('curd','cup','g',245)
sc('spice_whole','tsp','g',2.5); sc('spice_whole','tbsp','g',7.5)
sc('spice_ground','tsp','g',2.5); sc('spice_ground','tbsp','g',8)
sc('masala_blend','tsp','g',3); sc('masala_blend','tbsp','g',9)
sc('salt_sugar','tsp','g',5); sc('salt_sugar','tbsp','g',15)
sc('oil','tsp','ml',5); sc('oil','tbsp','ml',15)
sc('ghee_butter','tsp','g',4.5); sc('ghee_butter','tbsp','g',14); sc('ghee_butter','ml','g',0.91)
sc('curd','tbsp','g',15); sc('nut_seed','tbsp','g',9)
sc('condiment_sauce','tsp','ml',5); sc('condiment_sauce','tbsp','ml',15)
sc('paste','tsp','g',5); sc('paste','tbsp','g',15)
sc('pickle_chutney','tsp','g',5); sc('pickle_chutney','tbsp','g',15)
sc('beverage','tsp','g',3); sc('beverage','tbsp','g',9)
sc('baking_misc','tsp','g',4.5); sc('baking_misc','tbsp','g',14)
sc('leafy_herb','bunch','g',100); sc('egg','dozen','piece',12); sc('fruit','dozen','piece',12)
sc('bakery','slice','piece',1); sc('leafy_herb','tbsp','g',4); sc('beverage','cup','ml',240)
SOLID_PIECE_DEFAULT = {}  # piece weights are per ingredient (column piece_g)
DRY_GOODS_OVERRIDE = re.compile(r'^(Poha|Sooji|Idli Rava|Besan|Vermicelli|Sabudana|Murmura|Roasted Vermicelli|Rice Noodles|Pasta|Noodles|Bread Crumbs|Puffed Millet)')
BUNCH_G={'Curry Leaves':25}
# Juice measures for ingredients bought whole: 1 lemon (40 g) yields about 30 ml, so 1 ml is 4/3 g of lemon.
JUICE_G={'Lemon':{'ml':1.3333,'tsp':6.6667,'tbsp':20}}
NOTES={'Curry Leaves':'1 bunch is about 100-120 leaves (about 25 g)'}
LABELS={'dal':'Dal','grain':'Grain','spice':'Spice','dairy':'Dairy','eggs':'Eggs','produce':'Produce','dry_goods':'Dry Goods','oil':'Oil','meat_fish':'Meat & Fish','condiment':'Condiment','bakery':'Bakery','snacks':'Snacks','beverages':'Beverages','frozen':'Frozen','other':'Other'}
PIECE_OVERRIDES={'Cloves':0.1,'Green Cardamom':0.5,'Black Cardamom':2,'Cinnamon Stick':3,'Dried Red Chilli':2,'Bay Leaf':0.5,'Star Anise':1,'Black Pepper (Whole)':0.05}
rows=[]; seen=collections.OrderedDict(); dups=[]
for f in sorted(glob.glob(os.path.join(HERE,'src','*.txt'))):
    sub=None
    for line in open(f,encoding='utf8'):
        line=line.rstrip('\n')
        if not line.strip() or line.startswith('#') and not line.startswith('##'): continue
        if line.startswith('## '): sub=line[3:].strip(); continue
        parts=[p.strip() for p in line.split('|')]
        parts += ['']*(4-len(parts))
        name,aliases,piece,cup=parts[:4]
        key=name.lower()
        if key in seen: dups.append((name,seen[key],sub)); continue
        seen[key]=sub
        app=APP_CAT[sub]
        if sub in ('whole_grain','flour') and DRY_GOODS_OVERRIDE.match(name): app='dry_goods'
        al=[a.strip() for a in aliases.split(';') if a.strip()]
        piece=piece or str(PIECE_OVERRIDES.get(name,''))
        rows.append(dict(name=name,sub=sub,app=app,aliases=al,piece=piece,cup=cup,units=UNITS[sub]))
rows.sort(key=lambda r:(r['app'],r['sub'],r['name']))
slug=lambda s:re.sub(r'[^a-z0-9]+','_',s.lower()).strip('_')
with open(os.path.join(HERE,'ingredients.csv'),'w',newline='',encoding='utf8') as fh:
    w=csv.writer(fh); w.writerow(['id','canonical_name','app_category','app_category_label','subcategory','aliases','allowed_units','default_unit','piece_g','cup_g_override','note'])
    for r in rows:
        w.writerow([slug(r['name']),r['name'],r['app'],LABELS[r['app']],r['sub'],'|'.join(r['aliases']),r['units'],r['units'].split('|')[0],r['piece'],r['cup'],NOTES.get(r['name'],'')])
with open(os.path.join(HERE,'conversions.csv'),'w',newline='',encoding='utf8') as fh:
    w=csv.writer(fh); w.writerow(['scope','subcategory_or_ingredient','unit','base_unit','amount_per_unit'])
    for (s,u),(b,a) in sorted(CONV.items()):
        if u in UNITS[s].split('|'): w.writerow(['subcategory',s,u,b,a])
    for r in rows:
        if r['cup']: w.writerow(['ingredient',r['name'],'cup','g' if r['sub'] not in ('oil','dairy_liquid','condiment_sauce') else 'ml',r['cup']])
        if r['name'] in BUNCH_G: w.writerow(['ingredient',r['name'],'bunch','g',BUNCH_G[r['name']]])
        if r['piece']: w.writerow(['ingredient',r['name'],'piece','g',r['piece']])
        for u,g in JUICE_G.get(r['name'],{}).items(): w.writerow(['ingredient',r['name'],u,'g',g])
# human-readable
by=collections.OrderedDict()
for r in rows: by.setdefault(r['app'],collections.OrderedDict()).setdefault(r['sub'],[]).append(r)
out=['# Ingredient catalog — DRAFT for founder sign-off','',f'{len(rows)} canonical ingredients · {sum(len(r["aliases"]) for r in rows)} aliases · {len(by)} app categories.','',
 'Columns: **Canonical name** (what the app stores and shows) · **Also called** (aliases mapped to it on import) · **Units** (first is the default).','',
 '`NEW` = an app category that does not exist today.','']
for app,subs in by.items():
    n=sum(len(v) for v in subs.values())
    out.append(f'## {LABELS[app]}{" (NEW)" if app in NEW_CATS else ""} — {n}')
    for sub,items in subs.items():
        out.append(f'### {sub} — {len(items)}  ·  units: `{UNITS[sub].replace("|"," / ")}`')
        out.append('| Canonical name | Also called |'); out.append('|---|---|')
        for r in items: out.append(f'| {r["name"]} | {"; ".join(r["aliases"])} |')
        out.append('')
open(os.path.join(HERE,'ingredients.md'),'w',encoding='utf8').write('\n'.join(out))
print(len(rows),'ingredients; dup names skipped:',len(dups))
for d in dups: print('  dup',d)
cnt=collections.Counter(r['app'] for r in rows); print(dict(cnt))
