"""Native optimizer identity, schema immutability and checkpoint consumers."""
import copy
import io
import numpy as np
import pytest
import torch
from diffusion.model import DiffusionRouteModel
from diffusion.trainer import DiffusionTrainer


def model(cond_dim=None):
    return DiffusionRouteModel(input_dim=2,hidden_dim=8,num_heads=2,
                               num_layers=1,num_timesteps=4,cond_dim=cond_dim)


def inputs(dtype=torch.float32):
    return torch.randn(2,3,2,dtype=dtype),torch.tensor([0,2]),torch.randn(2,3,dtype=dtype)


@pytest.mark.parametrize('width',[None,3])
def test_adam_owns_materialization_and_trains_condition(width):
    torch.manual_seed(42)
    m=model(width)
    optimizer=torch.optim.Adam(m.parameters(),lr=.01)
    ids=[id(p) for p in m.cond_proj.parameters()]
    owned={id(p) for g in optimizer.param_groups for p in g['params']}
    assert all(i in owned for i in ids)
    x,t,c=inputs()
    loss=m(x,t,c).square().mean()
    before=m.cond_proj.weight.detach().clone()
    loss.backward()
    assert m.cond_proj.weight.grad is not None and m.cond_proj.weight.grad.abs().sum()>0
    optimizer.step()
    assert ids == [id(p) for p in m.cond_proj.parameters()]
    assert not torch.equal(before,m.cond_proj.weight)
    assert optimizer.state[m.cond_proj.weight]['step']==1


@pytest.mark.parametrize('kind',['global','row','token','singleton-token','appended'])
def test_condition_broadcast_has_independent_same_output(kind):
    m=model(3).eval()
    x,t,c=inputs()
    if kind=='global': c=c[0]
    elif kind=='token': c=c[:,None,:].expand(-1,3,-1)
    elif kind=='singleton-token': c=c[:,None,:]
    shaped=c[None,:] if c.ndim==1 else c
    if shaped.ndim==2: shaped=shaped[:,None,:]
    expanded=shaped.expand(2,3,3)
    expected=m(x,t,expanded)
    actual=m(torch.cat([x,expanded],dim=-1),t) if kind=='appended' else m(x,t,c)
    torch.testing.assert_close(actual,expected)


@pytest.mark.parametrize('bad',[
    torch.ones(2,4),torch.ones(3,3),torch.ones(2,2,3),torch.ones(2,0),
    torch.full((2,3),float('nan')),torch.full((2,3),float('inf')),
    torch.ones(2,3,dtype=torch.bool),torch.ones(2,3,dtype=torch.complex64),
    torch.ones(2,1,1,3)])
def test_invalid_condition_preserves_learned_schema_and_rng(bad):
    m=model(3).train()
    x,t,_=inputs()
    state=copy.deepcopy(m.state_dict())
    ids=[id(p) for p in m.parameters()]
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError): m(x,t,bad)
    assert ids == [id(p) for p in m.parameters()]
    for k,v in state.items(): torch.testing.assert_close(m.state_dict()[k],v,rtol=0,atol=0)
    assert torch.equal(rng,torch.get_rng_state())


def test_invalid_first_context_does_not_materialize_lazy_parameters():
    m=model()
    x,t,_=inputs()
    rng=torch.get_rng_state().clone()
    ids=[id(p) for p in m.cond_proj.parameters()]
    with pytest.raises(ValueError): m(x,t,torch.full((2,3),float('nan')))
    assert isinstance(m.cond_proj.weight,torch.nn.parameter.UninitializedParameter)
    assert ids == [id(p) for p in m.cond_proj.parameters()]
    assert torch.equal(rng,torch.get_rng_state())


def test_materialized_width_is_fixed_without_replacing_parameters():
    m=model().eval()
    x,t,c=inputs()
    m(x,t,c)
    before=m.cond_proj.weight.detach().clone()
    ids=[id(p) for p in m.cond_proj.parameters()]
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError): m(x,t,torch.ones(2,4))
    torch.testing.assert_close(m.cond_proj.weight,before,rtol=0,atol=0)
    assert ids == [id(p) for p in m.cond_proj.parameters()]
    assert torch.equal(rng,torch.get_rng_state())


@pytest.mark.parametrize('width',[None,3])
def test_double_precision_condition_and_gradient(width):
    m=model(width).double()
    x,t,c=inputs(torch.float64)
    out=m(x,t,c.float())
    assert out.dtype==torch.float64
    out.square().sum().backward()
    assert m.cond_proj.weight.dtype==torch.float64
    assert torch.isfinite(m.cond_proj.weight.grad).all()


def test_native_checkpoint_next_adam_step_matches():
    torch.manual_seed(12)
    m=model().eval()
    o=torch.optim.Adam(m.parameters(),lr=.01)
    x,t,c=inputs()
    m(x,t,c).square().mean().backward();o.step();o.zero_grad()
    checkpoint=io.BytesIO()
    torch.save({'model':m.state_dict(),'optimizer':o.state_dict()},checkpoint)
    checkpoint.seek(0)
    saved=torch.load(checkpoint,weights_only=True)
    restored=model().eval()
    ro=torch.optim.Adam(restored.parameters(),lr=.01)
    restored.load_state_dict(saved['model'])
    ro.load_state_dict(saved['optimizer'])
    torch.testing.assert_close(restored(x,t,c),m(x,t,c))
    for current,optimizer in [(m,o),(restored,ro)]:
        current(x,t,c).square().mean().backward();optimizer.step()
    for key,value in m.state_dict().items():
        torch.testing.assert_close(restored.state_dict()[key],value,rtol=0,atol=0)


def test_native_trainer_condition_and_unconditional_learning():
    torch.manual_seed(3)
    m=model()
    trainer=DiffusionTrainer(m,device='cpu',lr=.01,batch_size=2)
    x,t,c=inputs()
    # Existing trainer accepts per-token context, and its joint dataset expands rows.
    history=trainer.train(x,epochs=2,condition_data=c)
    assert np.isfinite(history['train_losses']).all()
    assert trainer.optimizer.state[m.cond_proj.weight]['step']==2
    before=m.cond_proj.weight.detach().clone()
    trainer.train_step(x,c[:,None,:].expand(-1,3,-1))
    assert not torch.equal(before,m.cond_proj.weight)
    unconditional=model()
    plain=DiffusionTrainer(unconditional,device='cpu')
    assert np.isfinite(plain.train_step(x))
    assert isinstance(unconditional.cond_proj.weight,torch.nn.parameter.UninitializedParameter)


def test_explicit_and_appended_duplicate_rejected_before_rng():
    m=model()
    x,t,c=inputs()
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError): m(torch.cat([x,c[:,None,:].expand(-1,3,-1)],-1),t,c)
    assert torch.equal(rng,torch.get_rng_state())


@pytest.mark.parametrize('width',[0,-1,1.5,True])
def test_invalid_declared_width(width):
    with pytest.raises(ValueError): model(width)
