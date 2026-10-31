"""Matched native feature inputs. No STEP, BREP or mesh imports.
Run from the CAD repository. The robot Part is read from its shipped archive.
"""
import hashlib,json,math,sys,zipfile
from pathlib import Path

OUT=Path(sys.argv[1] if len(sys.argv)>1 else 'build/native-comparison/fixtures')
OUT.mkdir(parents=True,exist_ok=True)
def profile(ident,contours,z=0):
    return dict(id=ident,name=ident,type='profile',plane='XY',offsetMillimeters=z,suppressed=False,
        profile=dict(type='drawing',contours=contours,constraints=[dict(id=f'fixed-{i}',kind='fix',a=dict(contour=i,kind='contour'),fixedGeometry=c) for i,c in enumerate(contours)]))
def rect(w,h):
    return dict(type='path',start=[-w/2,-h/2],segments=[dict(type='line',end=p) for p in [[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2]]])
def circle(x,y,r): return dict(type='circle',center=[x,y],radius=r)
def extrude(ident,sketch,distance,operation='new'):
    return dict(id=ident,name=ident,type='extrude',profileFeatureId=sketch,distanceMillimeters=distance,operation=operation,suppressed=False)
def doc(name,features): return dict(format='aether-part',formatVersion=22,documentId=name,name=name,units='millimeter',features=features)
fixtures={}
fixtures['plate']=dict(document=doc('plate',[profile('base',[rect(100,60)]),extrude('pad','base',10)]),expectedVolume=60000,edit=dict(featureId='pad',field='distanceMillimeters',value=11))
f=fixtures['plate']['document']['features'].copy()
for i in range(10):
    f += [profile(f'bore-{i}',[circle(-40+(i%5)*20,-15+(i//5)*30,3)],10),extrude(f'cut-{i}',f'bore-{i}',10,'cut')]
fixtures['ten-bores']=dict(document=doc('ten-bores',f),expectedVolume=60000-10*math.pi*9*10,edit=dict(featureId='cut-9',field='distanceMillimeters',value=9))
fixtures['annular-shell']=dict(document=doc('annular-shell',[profile('annulus',[circle(0,0,30),circle(0,0,27)]),extrude('wall','annulus',60)]),expectedVolume=math.pi*(900-729)*60,edit=dict(featureId='wall',field='distanceMillimeters',value=61))
# Select the annular cell explicitly: Aether's whole-sketch selection also includes
# the inner disc. The other adapters choose the nested-loop annulus by default.
ring=fixtures['annular-shell']['document']['features']
for c,ident in zip(ring[0]['profile']['contours'],['outer','inner']): c['id']=ident
ring[1].update(regionMode='faces',profileSelections=[dict(profileFeatureId='annulus',profileRegion=dict(contourIds=['outer','inner'],inside=['outer']))])
archive=Path('public/examples/scifirobot.acad.bin')
graph=json.loads(zipfile.ZipFile(archive).read('state/graph.json'))
front=next(p['feature_document'] for p in graph['part_definitions'] if p.get('feature_document',{}).get('name')=='Front shell')
fixtures['robot-front']=dict(document=front,sourceArchive=str(archive),sourceArchiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),edit=dict(featureId=front['features'][-2]['id'],field='offsetMillimeters',value=1.6))
for name,fixture in fixtures.items(): (OUT/f'{name}.json').write_text(json.dumps(fixture,indent=2)+'\n')
print(json.dumps({k:len(v['document']['features']) for k,v in fixtures.items()}))
