"""Independent integer occupancy/support and mass checks for native cargo plans."""
import copy
import itertools
import math
import random
import pytest
from models.bin_packing import BinPackingEngine, Container, Item


def check_integer_plan(container, items, result):
    by_id={item.item_id:item for item in items}
    occupied={}
    for placement in result['placements']:
        item=by_id[placement['item_id']]
        position=placement['position'];size=placement['dimensions']
        assert tuple(sorted(size))==tuple(sorted((item.length,item.width,item.height)))
        assert item.position==position and item.placed_dimensions==size
        assert size==list(itertools.permutations((item.length,item.width,item.height)))[item.rotation]
        assert all(0<=position[k] and position[k]+size[k]<=limit for k,limit in enumerate(
            (container.length,container.width,container.height)))
        cells=list(itertools.product(*(range(int(position[k]),int(position[k]+size[k])) for k in range(3))))
        assert all(cell not in occupied for cell in cells)
        if position[2]:
            assert all((a,b,int(position[2])-1) in occupied
                       for a in range(int(position[0]),int(position[0]+size[0]))
                       for b in range(int(position[1]),int(position[1]+size[1])))
        occupied.update({cell:item.item_id for cell in cells})
    assert len(occupied)==sum(math.prod(p['dimensions']) for p in result['placements'])
    mass=sum(by_id[p['item_id']].weight for p in result['placements'])
    assert mass==result['total_weight'] and mass<=container.max_weight
    assert result['utilization_percentage']==round(100*len(occupied)/(container.length*container.width*container.height),2)
    assert set(result['packed_items']).isdisjoint(result['unpacked_items'])
    assert set(result['packed_items'])|set(result['unpacked_items'])==set(by_id)


@pytest.mark.parametrize('shape',[(2,2,2),(3,2,2),(2,3,1),(1,1,4)])
def test_full_integer_cube_grid(shape):
    count=math.prod(shape)
    container=Container(*shape,count)
    items=[Item(str(i),1,1,1,1) for i in range(count)]
    result=BinPackingEngine().pack_cargo(container,items)
    assert result['success'] and result['utilization_percentage']==100
    check_integer_plan(container,items,result)


@pytest.mark.parametrize('dimensions',list(itertools.permutations((1,2,3))))
def test_all_axis_orientations_fit_and_are_published(dimensions):
    container=Container(1,2,3,10)
    items=[Item('rotated',*dimensions,2)]
    result=BinPackingEngine().pack_cargo(container,items)
    assert result['success'] and result['placements'][0]['dimensions']==(1.,2.,3.)
    check_integer_plan(container,items,result)


@pytest.mark.parametrize('seed',range(10))
def test_heterogeneous_native_plans_obey_independent_voxel_and_mass_rules(seed):
    rng=random.Random(seed)
    container=Container(4,4,4,15)
    items=[Item(str(i),rng.randint(1,2),rng.randint(1,2),rng.randint(1,2),rng.randint(0,3)) for i in range(20)]
    result=BinPackingEngine().pack_cargo(container,items)
    check_integer_plan(container,items,result)
    again=BinPackingEngine().pack_cargo(container,items)
    assert result==again


def test_coplanar_support_union_and_gap_rejection():
    engine=BinPackingEngine()
    base=Item('base',1,1,1,1)
    placements=[(base,(0.,0.,0.),(1.,1.,1.),0),(base,(1.,0.,0.),(1.,1.,1.),0)]
    assert engine._supported((0.,0.,1.),(2.,1.,.5),placements)
    placements[1]=(base,(1.1,0.,0.),(.9,1.,1.),0)
    assert not engine._supported((0.,0.,1.),(2.,1.,.5),placements)
    assert not engine._supported((0.,0.,1.),(2.,2.,.5),placements)
    assert engine._supported((0.,0.,0.),(2.,2.,.5),[])


def test_real_plan_places_small_height_box_on_combined_support():
    items=[Item('base-a',1,1,1,1),Item('base-b',1,1,1,1),Item('top',2,1,.5,1)]
    result=BinPackingEngine().pack_cargo(Container(2,1,1.5,3),items)
    assert result['success']
    assert items[2].position==(0.,0.,1.)
    assert items[2].placed_dimensions==(2.,1.,.5)


def test_repack_clears_rejected_item_positions():
    items=[Item('a',1,1,1,1),Item('b',1,1,1,1)]
    engine=BinPackingEngine()
    assert engine.pack_cargo(Container(2,1,1,2),items)['success']
    result=engine.pack_cargo(Container(1,1,1,1),items)
    assert result['packed_items']==['a'] and result['unpacked_items']==['b']
    assert items[1].position is None and items[1].placed_dimensions is None and items[1].rotation==0


@pytest.mark.parametrize('bad',['nan-dimension','zero-dimension','negative-weight','duplicate','bool-capacity','infinite-container'])
def test_complete_invalid_admission_preserves_previous_plan(bad):
    engine=BinPackingEngine()
    items=[Item('a',1,1,1,1),Item('b',1,1,1,1)]
    container=Container(2,1,1,2)
    engine.pack_cargo(container,items)
    if bad=='nan-dimension':items[-1].height=float('nan')
    elif bad=='zero-dimension':items[-1].width=0
    elif bad=='negative-weight':items[-1].weight=-1
    elif bad=='duplicate':items[-1].item_id='a'
    elif bad=='bool-capacity':container.max_weight=True
    else:container.length=float('inf')
    before=[copy.copy(item.__dict__) for item in items]
    with pytest.raises(ValueError):engine.pack_cargo(container,items)
    assert [item.__dict__ for item in items]==before


def test_overweight_and_infeasible_boxes_never_gain_positions():
    items=[Item('too-wide',3,3,3,1),Item('too-heavy',1,1,1,11),Item('fit',1,1,1,2)]
    result=BinPackingEngine().pack_cargo(Container(2,2,2,10),items)
    assert result['packed_items']==['fit']
    check_integer_plan(Container(2,2,2,10),items,result)
    assert all(item.position is None for item in items[:2])


def test_empty_request_preserves_existing_summary_semantics():
    result=BinPackingEngine().pack_cargo(Container(1,1,1,0),[])
    assert result['success'] and result['total_weight']==0 and result['utilization_percentage']==0
    assert result['placements']==[]
