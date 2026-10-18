"""Part placement/scaling through FreeCAD's public TopoShape transform APIs.

translate/rotate/scale preserve analytic geometry; nonuniform transformGeometry
uses the native B-rep builder. Every result is validated before bodies change.
"""
import math


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _vector(value, label):
    import FreeCAD
    if not isinstance(value, list) or len(value) != 3 or not all(_number(v) for v in value):
        raise ValueError(f'{label} needs three finite coordinates.')
    return FreeCAD.Vector(*value)


def transformed_shape(shape, transform):
    import FreeCAD
    if not isinstance(transform, dict):
        raise TypeError('Choose a valid part transform.')
    kind=transform.get('kind')
    result=shape.copy()
    volume_ratio=1
    if kind=='translate':
        result.translate(_vector(transform.get('translationMillimeters'),'Translation'))
    elif kind=='rotate':
        origin=_vector(transform.get('axisOriginMillimeters'),'Rotation origin')
        axis=_vector(transform.get('axisDirection'),'Rotation axis')
        angle=transform.get('angleDegrees')
        if abs(axis.Length-1)>1e-6 or not _number(angle):
            raise ValueError('Rotation needs a unit axis and a finite angle in degrees.')
        result.rotate(origin,axis,angle)
    elif kind=='scale':
        center=_vector(transform.get('centerMillimeters'),'Scale center')
        factors=transform.get('scaleFactors')
        _vector(factors,'Scale factors')
        if any(v<=0 for v in factors):
            raise ValueError('Scale factors must be positive.')
        volume_ratio=math.prod(factors)
        if not math.isfinite(volume_ratio) or volume_ratio<=0:
            raise ValueError('Scale factors exceed the supported numeric range.')
        if factors[0]==factors[1]==factors[2]:
            result.scale(factors[0],center)
        else:
            matrix=FreeCAD.Matrix()
            matrix.A11,matrix.A22,matrix.A33=factors
            matrix.A14,matrix.A24,matrix.A34=[center[i]*(1-factors[i]) for i in range(3)]
            result=result.transformGeometry(matrix)
    elif kind!='copy':
        raise ValueError('Choose Translate, Rotate, Scale or Copy in place.')
    if result.isNull() or not result.isValid() or len(result.Solids)!=len(shape.Solids) or not math.isfinite(result.Volume) or result.Volume<=1e-9:
        raise ValueError('Transform must preserve valid solid geometry. Check the parameters.')
    try:
        result.check(True)
    except Exception as error:
        if kind == 'scale' and len(set(factors)) > 1:
            raise ValueError('This part cannot yet be scaled differently on each axis without invalid geometry. Use Uniform scale or revise the source feature dimensions.') from error
        raise
    expected=shape.Volume*volume_ratio
    if not math.isfinite(expected) or abs(result.Volume-expected)>max(1e-6,expected*1e-7):
        raise ValueError('Transform did not preserve the expected solid volume. For curved parts, use Uniform scale or revise the source feature dimensions.')
    return result


def transform_parts(document, feature, bodies, snapshots):
    p=feature.parameters
    ids=p.get('body_ids')
    from aether_freecad.transform_reference import resolve_transform

    transform, _ = resolve_transform(p.get('transform'), snapshots)
    copies=p.get('copy_body_ids')
    if (not isinstance(ids,list) or not 0<len(ids)<=256
            or any(not isinstance(i,str) or not i.strip() for i in ids) or len(set(ids))!=len(ids)):
        raise ValueError('Choose distinct solid parts to transform (up to 256).')
    if copies is not None:
        if not isinstance(copies,dict) or set(copies)!=set(ids):
            raise ValueError('Each copied part needs one output identity.')
        values=list(copies.values())
        if any(not isinstance(i,str) or not i.strip() or i in bodies for i in values) or len(set(values))!=len(values):
            raise ValueError('Copy outputs need distinct new body identities.')
    if isinstance(transform,dict) and transform.get('kind')=='copy' and copies is None:
        raise ValueError('Copy in place needs new body identities.')
    pending={}
    for key in ids:
        body=bodies.get(key)
        if body is None or not hasattr(body,'Shape') or body.Shape.isNull() or not body.Shape.Solids:
            raise ValueError('A selected solid part is unavailable. Reselect the parts.')
        pending[key]=transformed_shape(body.Shape,transform)
    outputs=[]
    for key,shape in pending.items():
        output_key=copies[key] if copies else key
        if copies:
            body=document.addObject('PartDesign::Body','TransformCopy')
            body.addProperty('App::PropertyString','AetherSourceFeatureId')
            body.AetherSourceFeatureId=feature.id
            bodies[output_key]=body
        else:
            body=bodies[key]
        result=document.addObject('PartDesign::Feature','PartTransform')
        body.addObject(result)
        result.Shape=shape
        body.Tip=result
        snapshots[(feature.id,output_key)]=shape.copy()
        outputs.append(result)
    document.recompute()
    if len(outputs)==1:
        snapshots[feature.id]=outputs[0]
    else:
        snapshots.pop(feature.id,None)
