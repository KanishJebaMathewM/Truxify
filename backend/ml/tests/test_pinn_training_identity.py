"""Native observation/collocation ownership and explicit optimizer references."""
import copy
import numpy as np
import pytest
import torch
import torch.nn.functional as F
from pinns.model import PhysicsInformedNN, PhysicsLoss, PINNTrainer


def trainer(kind='poisson'):
    torch.manual_seed(71)
    m=PhysicsInformedNN(input_dim=2,hidden_dim=4,output_dim=1,num_layers=1)
    return PINNTrainer(m,PhysicsLoss(kind),lr=.002,device='cpu')


def data():
    x=torch.tensor([[.1,.2],[.3,.4],[.5,.6],[.7,.8],[.9,1.]])
    y=torch.tensor([1.,-1.,2.,-2.,3.])
    p=torch.tensor([[.1,.8],[.2,.7],[.3,.6],[.4,.5],[.5,.4],[.6,.3],[.7,.2]])
    return x,y,p,p[:,0:1]*10


def state_equal(actual,expected):
    if isinstance(expected,dict):
        assert actual.keys()==expected.keys()
        for k in expected: state_equal(actual[k],expected[k])
    elif isinstance(expected,(list,tuple)):
        assert len(actual)==len(expected)
        for a,e in zip(actual,expected): state_equal(a,e)
    elif isinstance(expected,torch.Tensor): torch.testing.assert_close(actual,expected,rtol=0,atol=0)
    else: assert actual==expected


def test_vector_and_column_targets_have_identical_native_updates():
    x,y,p,f=data()
    a,b=trainer(),trainer()
    ra=a.train_step(x,y,p,f=f)
    rb=b.train_step(x,y[:,None],p,f=f)
    assert ra==rb
    state_equal(a.model.state_dict(),b.model.state_dict())
    state_equal(a.optimizer.state_dict(),b.optimizer.state_dict())


@pytest.mark.parametrize('batch_size',[1,2,3,5,9])
def test_full_loop_matches_explicit_owned_adam_reference(batch_size):
    current=trainer()
    reference=copy.deepcopy(current.model)
    opt=torch.optim.Adam(reference.parameters(),lr=.002)
    x,y,p,f=data()
    losses=[]
    data_losses=[]
    phys_losses=[]
    torch.manual_seed(987)
    for _ in range(2):
        permutation=torch.randperm(len(x))
        sums=np.zeros(3)
        for start in range(0,len(x),batch_size):
            selected=permutation[start:start+batch_size]
            physics=torch.randperm(len(p))[:batch_size]
            coordinates=p[physics].detach().clone().requires_grad_(True)
            d=F.mse_loss(reference(x[selected]),y[selected,None])
            ph=PhysicsLoss('poisson').compute_loss(reference(coordinates),coordinates,f=f[physics])
            loss=d+ph
            opt.zero_grad();loss.backward()
            torch.nn.utils.clip_grad_norm_(reference.parameters(),1.)
            opt.step()
            sums += np.array([loss.item(),d.item(),ph.item()])*len(selected)
        sums/=len(x)
        losses.append(sums[0]);data_losses.append(sums[1]);phys_losses.append(sums[2])
    torch.manual_seed(987)
    history=current.train(x,y,p,epochs=2,batch_size=batch_size,f=f)
    np.testing.assert_array_equal(history['losses'],losses)
    np.testing.assert_array_equal(history['data_losses'],data_losses)
    np.testing.assert_array_equal(history['physics_losses'],phys_losses)
    state_equal(current.model.state_dict(),reference.state_dict())
    state_equal(current.optimizer.state_dict(),opt.state_dict())


@pytest.mark.parametrize('forcing',[2.,torch.tensor(2.),torch.full((7,),2.),torch.full((7,1),2.)])
def test_scalar_and_row_forcing_semantics(forcing):
    x,y,p,_=data()
    current=trainer()
    reference=trainer()
    torch.manual_seed(12)
    actual=current.train(x,y,p,epochs=1,batch_size=2,f=forcing)
    torch.manual_seed(12)
    expected=reference.train(x,y[:,None],p,epochs=1,batch_size=2,f=2.)
    assert actual==expected
    state_equal(current.model.state_dict(),reference.model.state_dict())


@pytest.mark.parametrize('kind',['targets','later-data','later-physics','forcing','coefficient','empty','batch','epochs'])
def test_invalid_complete_admission_preserves_existing_optimizer_and_modes(kind):
    current=trainer('diffusion' if kind=='coefficient' else 'poisson')
    x,y,p,f=data()
    current.train_step(x,y,p,**({'D':1.} if kind=='coefficient' else {'f':f}))
    current.model.eval()
    model_before=copy.deepcopy(current.model.state_dict())
    optimizer_before=copy.deepcopy(current.optimizer.state_dict())
    scheduler_before=copy.deepcopy(current.scheduler.state_dict())
    grads=[v.grad.clone() if v.grad is not None else None for v in current.model.parameters()]
    options={'epochs':1,'batch_size':2,'f':f}
    if kind=='targets': y=y[:-1]
    elif kind=='later-data': x[-1,0]=float('nan')
    elif kind=='later-physics': p[-1,0]=float('inf')
    elif kind=='forcing': f[-1,0]=float('nan')
    elif kind=='coefficient': options={'epochs':1,'batch_size':2,'D':float('nan')}
    elif kind=='empty': x=x[:0];y=y[:0]
    elif kind=='batch': options['batch_size']=True
    elif kind=='epochs': options['epochs']=1.5
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError): current.train(x,y,p,**options)
    state_equal(current.model.state_dict(),model_before)
    state_equal(current.optimizer.state_dict(),optimizer_before)
    state_equal(current.scheduler.state_dict(),scheduler_before)
    for v,g in zip(current.model.parameters(),grads): state_equal(v.grad,g)
    assert not current.model.training
    assert torch.equal(torch.get_rng_state(),rng)


def test_caller_collocation_gradient_leaves_unchanged():
    x,y,p,f=data()
    p.requires_grad_(True)
    before=p.detach().clone()
    current=trainer()
    history=current.train(x,y,p,epochs=2,batch_size=3,f=f)
    assert np.isfinite(history['losses']).all()
    assert p.requires_grad and p.grad is None
    torch.testing.assert_close(p,before,rtol=0,atol=0)


def test_nonfinite_objective_never_advances_adam():
    x,y,p,f=data()
    current=trainer()
    current.train_step(x,y,p,f=f)
    before=copy.deepcopy(current.optimizer.state_dict())
    weights=copy.deepcopy(current.model.state_dict())
    y=torch.full_like(y,1e30)
    with pytest.raises(ValueError,match='objective'): current.train_step(x,y,p,f=f)
    state_equal(current.optimizer.state_dict(),before)
    state_equal(current.model.state_dict(),weights)


def test_float64_and_checkpoint_next_owned_step(tmp_path):
    a=trainer();a.model.double()
    x,y,p,f=[v.double() for v in data()]
    a.train(x,y,p,epochs=1,batch_size=3,f=f)
    target=tmp_path/'pinn.pth';a.save(str(target))
    b=trainer();b.model.double();b.load(str(target))
    torch.manual_seed(91);ra=a.train(x,y,p,epochs=1,batch_size=2,f=f)
    torch.manual_seed(91);rb=b.train(x,y,p,epochs=1,batch_size=2,f=f)
    assert ra==rb
    state_equal(a.model.state_dict(),b.model.state_dict())
    state_equal(a.optimizer.state_dict(),b.optimizer.state_dict())
