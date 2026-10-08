"""Full native parameter-coordinate gradients and numerical surgery controls."""
import copy

import pytest
import torch
from torch import nn

from mtl.model import GradientSurgery, MultiTaskModel, MultiTaskTrainer, MTLLoss


def native(width=2):
    torch.manual_seed(31)
    model=MultiTaskModel(2,{'a':{'output_dim':1},'b':{'output_dim':width}},hidden_dim=8)
    for module in model.modules():
        if isinstance(module,nn.Dropout):module.p=0
    trainer=MultiTaskTrainer(model,MTLLoss({'a':nn.MSELoss(),'b':nn.MSELoss()}),device='cpu')
    return model,trainer


def reference(model,trainer,x,targets):
    params=[p for p in model.parameters() if p.requires_grad]
    losses=trainer.loss.compute_losses(model(x),targets)
    vectors=[]
    for name,loss in losses.items():
        values=torch.autograd.grad(loss*trainer.task_weights.get(name,1.),params,retain_graph=True,allow_unused=True)
        vectors.append(torch.cat([(g if g is not None else torch.zeros_like(p)).flatten() for p,g in zip(params,values)]))
    # Independent coordinate-space reference using the ordered orthogonal
    # projection matrix, rather than calling the production surgery helper.
    resolved=[]
    for i,g in enumerate(vectors):
        value=g.clone()
        for j,other in enumerate(vectors):
            if i!=j and torch.dot(value,other)<0:
                unit=other/other.norm()
                value=value-torch.dot(value,unit)*unit
        resolved.append(value)
    return torch.stack(resolved).sum(0)


@pytest.mark.parametrize('width',[1,2,4])
@pytest.mark.parametrize('weights',[{'a':1.,'b':1.},{'a':.2,'b':3.},{'a':0.,'b':1.}])
def test_native_gradient_identity_for_heterogeneous_and_weighted_heads(width,weights):
    model,trainer=native(width)
    trainer.task_weights=weights
    x=torch.randn(4,2)
    targets={'a':torch.randn(4,1),'b':torch.randn(4,width)}
    expected=reference(model,trainer,x,targets)
    trainer.optimizer.step=lambda:None
    result=trainer.train_step(x,targets)
    actual=torch.cat([p.grad.flatten() for p in model.parameters()])
    torch.testing.assert_close(actual,expected,atol=3e-6,rtol=3e-5)
    assert torch.isfinite(torch.tensor(result['total_loss']))


def test_actual_adam_updates_heterogeneous_heads():
    model,trainer=native(3)
    before=copy.deepcopy(model.state_dict())
    result=trainer.train_step(torch.randn(4,2),{'a':torch.randn(4,1),'b':torch.randn(4,3)})
    assert torch.isfinite(torch.tensor(result['total_loss']))
    assert trainer.optimizer.state
    for name in ('a','b'):
        assert any(not torch.equal(v,before['task_heads.'+name+'.'+k]) for k,v in model.task_heads[name].state_dict().items())
    assert all(torch.isfinite(v).all() for v in model.parameters())


def test_frozen_and_entirely_disconnected_parameters_skip_optimizer():
    model,trainer=native()
    model.register_parameter('unused',nn.Parameter(torch.ones(3)))
    # Rebuild optimizer to include the disconnected parameter.
    trainer.optimizer=torch.optim.Adam(model.parameters())
    first=next(model.shared_encoder.parameters())
    first.requires_grad_(False)
    old=first.detach().clone()
    trainer.train_step(torch.randn(4,2),{'a':torch.randn(4,1),'b':torch.randn(4,2)})
    assert model.unused.grad is None
    assert model.unused not in trainer.optimizer.state
    assert first.grad is None
    torch.testing.assert_close(first,old)


def test_zero_weight_private_head_has_zero_derivative():
    model,trainer=native()
    trainer.task_weights={'a':0.,'b':1.}
    before=copy.deepcopy(model.task_heads['a'].state_dict())
    trainer.train_step(torch.randn(4,2),{'a':torch.randn(4,1),'b':torch.randn(4,2)})
    for k,v in model.task_heads['a'].state_dict().items():torch.testing.assert_close(v,before[k])
    assert all(torch.count_nonzero(p.grad)==0 for p in model.task_heads['a'].parameters())


def test_sequential_projection_uses_updated_vector_and_preserves_inputs():
    vectors=[torch.tensor([1.,0.]),torch.tensor([-1.,1.]),torch.tensor([0.,-1.])]
    saved=[v.clone() for v in vectors]
    result=GradientSurgery.pcgrad(vectors)
    torch.testing.assert_close(result[0],torch.tensor([.5,0.]))
    for old,value in zip(saved,vectors):torch.testing.assert_close(old,value)
    assert all(v.data_ptr()!=r.data_ptr() for v,r in zip(vectors,result))


@pytest.mark.parametrize('vectors',[[],[torch.zeros(3)],[torch.zeros(3),torch.ones(3)]])
def test_empty_singleton_zero_gradients_are_safe(vectors):
    result=GradientSurgery.pcgrad(vectors)
    assert len(result)==len(vectors)
    assert all(torch.isfinite(v).all() for v in result)


def test_non_pcgrad_weighted_backward_unchanged():
    model,trainer=native()
    trainer.gradient_method='standard'
    trainer.task_weights={'a':.2,'b':2.}
    x=torch.randn(4,2);targets={'a':torch.randn(4,1),'b':torch.randn(4,2)}
    losses=trainer.loss.compute_losses(model(x),targets)
    total=trainer.loss.compute_weighted_loss(losses,trainer.task_weights)
    params=list(model.parameters())
    expected=torch.autograd.grad(total,params)
    trainer.optimizer.step=lambda:None
    trainer.train_step(x,targets)
    for p,g in zip(params,expected):torch.testing.assert_close(p.grad,g)
