"""Native manufactured fields, parameter gradients and mounted ASGI training."""
import copy

import httpx
import pytest
import torch
from fastapi import FastAPI

from pinns.model import PhysicsInformedNN, PhysicsLoss, PINNTrainer


def points():
    return torch.tensor([[.2,.3],[.4,.5],[-.7,.6]],dtype=torch.float64,requires_grad=True)


@pytest.mark.parametrize('D', [.1, 1., 3.])
def test_manufactured_exact_heat_solution(D):
    x=points()
    u=x[:,0:1].square()+2*D*x[:,1:2]
    assert PhysicsLoss().diffusion_loss(u,x,D).item() == pytest.approx(0., abs=1e-25)


@pytest.mark.parametrize('speed', [-2., 0., 1., 4.])
def test_manufactured_exact_advection_solution(speed):
    x=points()
    u=torch.sin(x[:,0:1]-speed*x[:,1:2])
    assert PhysicsLoss().advection_loss(u,x,speed).item() == pytest.approx(0., abs=1e-25)


def test_burgers_exact_affine_time_solution():
    x=points()
    u=x[:,0:1]/(1+x[:,1:2])
    assert PhysicsLoss().burger_loss(u,x,.3).item() == pytest.approx(0.,abs=1e-25)


@pytest.mark.parametrize('kind', ['diffusion','advection','burger'])
def test_mixed_partial_field_matches_analytic_scalar_residual(kind):
    x=points()
    space,time=x[:,0:1],x[:,1:2]
    u=space.square()*time + time.square()
    ux=2*space*time
    ut=space.square()+2*time
    uxx=2*time
    if kind=='diffusion':
        expected=ut-1.7*uxx
        got=PhysicsLoss().diffusion_loss(u,x,1.7)
    elif kind=='advection':
        expected=ut+1.7*ux
        got=PhysicsLoss().advection_loss(u,x,1.7)
    else:
        expected=ut+u*ux-.2*uxx
        got=PhysicsLoss().burger_loss(u,x,.2)
    torch.testing.assert_close(got, expected.square().mean())


@pytest.mark.parametrize('dims', [1,2,3])
def test_poisson_diagonal_laplacian_excludes_mixed_partials(dims):
    x=torch.randn(5,dims,dtype=torch.float64,requires_grad=True)
    u=3*x.square().sum(1,keepdim=True)
    if dims>1:u=u+11*x[:,0:1]*x[:,1:2]
    f=torch.full((5,1),-6*dims,dtype=x.dtype)
    assert PhysicsLoss().poisson_loss(u,x,f).item()==pytest.approx(0.,abs=1e-25)


@pytest.mark.parametrize('kind', ['diffusion','advection','burger','poisson'])
def test_constant_field_has_zero_derivatives_and_keeps_backward(kind):
    x=points()
    parameter=torch.tensor(2.,requires_grad=True,dtype=x.dtype)
    u=parameter.expand(len(x),1)
    loss=PhysicsLoss(kind).compute_loss(u,x)
    assert loss.item()==pytest.approx(0.,abs=1e-25)
    loss.backward()
    assert parameter.grad.item()==0


def test_heat_parameter_gradient_matches_closed_form():
    x=points()
    scale=torch.tensor(.7,requires_grad=True,dtype=x.dtype)
    u=scale*(x[:,0:1].square()+3*x[:,1:2])
    loss=PhysicsLoss().diffusion_loss(u,x)
    loss.backward()
    assert loss.item()==pytest.approx(.49)
    assert scale.grad.item()==pytest.approx(1.4)


@pytest.mark.parametrize('kind', ['diffusion','advection','burger','poisson'])
def test_real_native_training_steps_own_collocation_graph(kind):
    model=PhysicsInformedNN(hidden_dim=8,num_layers=2)
    trainer=PINNTrainer(model,PhysicsLoss(kind),device='cpu')
    before=copy.deepcopy(model.state_dict())
    data=torch.randn(5,2)
    collocation=torch.randn(7,2)
    original=collocation.clone()
    result=trainer.train(data,torch.randn(5,1),collocation,epochs=2,batch_size=2)
    assert all(torch.isfinite(torch.tensor(result['losses'])))
    assert len(result['losses'])==2
    assert trainer.optimizer.state
    assert any(not torch.equal(value,model.state_dict()[key]) for key,value in before.items())
    assert not collocation.requires_grad
    assert collocation.grad is None
    torch.testing.assert_close(collocation,original)


def test_preexisting_caller_autograd_graph_not_consumed():
    model=PhysicsInformedNN(hidden_dim=8,num_layers=2)
    trainer=PINNTrainer(model,PhysicsLoss(),device='cpu')
    source=torch.randn(4,2,requires_grad=True)
    points_from_caller=source*2
    for _ in range(2):
        trainer.train_step(torch.randn(4,2),torch.randn(4,1),points_from_caller)
    assert source.grad is None
    points_from_caller.square().sum().backward()
    assert source.grad is not None


@pytest.mark.parametrize('u,x', [(torch.ones(2,2),torch.ones(2,2,requires_grad=True)),
                                (torch.ones(2,1),torch.ones(2,2)),
                                (torch.ones(2,1),torch.ones(2,3,requires_grad=True))])
def test_invalid_scalar_or_space_time_contract_rejected(u,x):
    with pytest.raises(ValueError):PhysicsLoss().diffusion_loss(u,x)


def test_poisson_rejects_vector_forcing_broadcast():
    x=points()
    with pytest.raises(ValueError,match='forcing'):
        PhysicsLoss().poisson_loss(x[:,0:1].square(),x,torch.ones(3,2))


@pytest.mark.asyncio
async def test_actual_asgi_train_with_native_small_model(monkeypatch):
    from routes import pinns_routes as r
    model=PhysicsInformedNN(hidden_dim=8,num_layers=2)
    physics=PhysicsLoss()
    trainer=PINNTrainer(model,physics,device='cpu')
    monkeypatch.setattr(r,'model',model)
    monkeypatch.setattr(r,'physics_loss',physics)
    monkeypatch.setattr(r,'trainer',trainer)
    app=FastAPI()
    app.include_router(r.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        response=await client.post('/pinns/train',json={'epochs':2,'batch_size':2,'data_points':5,'phys_points':7,'physics_type':'diffusion'})
        assert response.status_code==200,response.text
        assert torch.isfinite(torch.tensor(response.json()['data']['final_physics_loss']))
    assert trainer.optimizer.state
