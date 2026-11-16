"""Real denoiser traces and independent scalar reverse-transition references."""
import copy
import math
import numpy as np
import pytest
import torch
from diffusion.model import DiffusionRouteModel, DiffusionRouteGenerator


def generator(condition=None):
    torch.manual_seed(64)
    m=DiffusionRouteModel(input_dim=2,hidden_dim=8,num_heads=2,num_layers=1,
                          num_timesteps=8,cond_dim=condition)
    return DiffusionRouteGenerator(m,device='cpu')


@pytest.mark.parametrize('steps',[1,2,3,5,7])
def test_actual_denoiser_matches_scalar_ddim_reference_and_time_grid(steps):
    g=generator()
    g.model.eval()
    times=np.rint(np.linspace(7,0,steps)).astype(int).tolist()
    torch.manual_seed(17)
    initial=torch.randn(2,3,2)
    expected=initial.clone()
    with torch.no_grad():
        for index,current in enumerate(times):
            noise=g.denoise(expected,torch.full((2,),current)).numpy()
            a=float(g.alpha_bars[current])
            following=times[index+1] if index+1<len(times) else -1
            b=float(g.alpha_bars[following]) if following>=0 else 1.
            # Independent scalar loop implements Eq12, sigma=0.
            source=expected.numpy()
            result=np.empty_like(source)
            for position in np.ndindex(source.shape):
                clean=(float(source[position])-math.sqrt(1-a)*float(noise[position]))/math.sqrt(a)
                result[position]=math.sqrt(b)*clean+math.sqrt(1-b)*float(noise[position])
            expected=torch.from_numpy(result)
    expected_rng=torch.get_rng_state().clone()
    seen=[]
    hook=g.model.time_embed.register_forward_pre_hook(lambda _m,args:seen.append(int(args[0][0])))
    torch.manual_seed(17)
    actual=g.generate((2,3,2),num_steps=steps)
    hook.remove()
    torch.testing.assert_close(actual,expected,rtol=3e-6,atol=3e-6)
    assert seen==times and seen[0]==7
    if steps>1: assert seen[-1]==0
    assert len(set(seen))==steps
    assert torch.equal(torch.get_rng_state(),expected_rng)
    assert not actual.requires_grad and torch.isfinite(actual).all()


@pytest.mark.parametrize('steps',[None,8])
def test_full_schedule_keeps_adjacent_ddpm_law_and_rng(steps):
    g=generator()
    g.model.eval()
    torch.manual_seed(19)
    expected=torch.randn(2,3,2)
    with torch.no_grad():
        for current in reversed(range(8)):
            t=torch.full((2,),current)
            noise=g.denoise(expected,t)
            a=g.alphas[current];abar=g.alpha_bars[current];beta=g.betas[current]
            z=torch.randn_like(expected) if current else torch.zeros_like(expected)
            expected=(expected-(1-a)/torch.sqrt(1-abar)*noise)/torch.sqrt(a)
            expected=expected+torch.sqrt(beta)*z
    rng=torch.get_rng_state().clone()
    torch.manual_seed(19)
    actual=g.generate((2,3,2),num_steps=steps)
    torch.testing.assert_close(actual,expected,rtol=0,atol=0)
    assert torch.equal(torch.get_rng_state(),rng)


@pytest.mark.parametrize('steps',[0,-1,9,2.5,True])
def test_invalid_steps_rejected_before_sampling_rng(steps):
    g=generator()
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError):g.generate((1,2,2),num_steps=steps)
    assert torch.equal(rng,torch.get_rng_state())


@pytest.mark.parametrize('shape',[(0,2,2),(1,0,2),(1,2,3),(1,2),(True,2,2)])
def test_invalid_shape_rejected_before_rng(shape):
    g=generator()
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError):g.generate(shape,num_steps=3)
    assert torch.equal(rng,torch.get_rng_state())


@pytest.mark.parametrize('failure',[False,True])
def test_inference_owns_and_restores_heterogeneous_modes(failure):
    g=generator()
    g.model.train()
    g.model.blocks[0].eval()
    modes={m:m.training for m in g.model.modules()}
    observed=[]
    hook=g.model.blocks[0].dropout.register_forward_pre_hook(lambda m,_:observed.append(m.training))
    if failure:
        with torch.no_grad(): g.model.output_proj[-1].bias.fill_(float('nan'))
        with pytest.raises(RuntimeError,match='finite'): g.generate((1,3,2),num_steps=3)
    else:g.generate((1,3,2),num_steps=3)
    hook.remove()
    assert observed and not any(observed)
    assert all(m.training==v for m,v in modes.items())


@pytest.mark.parametrize('steps',[1,3,8])
def test_endpoint_condition_consumer_and_parameter_immutability(steps):
    g=generator(4)
    before=copy.deepcopy(g.model.state_dict())
    start=torch.tensor([[1.,2.],[3.,4.]])
    end=torch.tensor([[5.,6.],[7.,8.]])
    actual=g.generate_route(start,end,route_length=4,num_steps=steps)
    assert actual.shape==(2,4,2)
    torch.testing.assert_close(actual[:,0],start,rtol=0,atol=0)
    torch.testing.assert_close(actual[:,-1],end,rtol=0,atol=0)
    assert torch.isfinite(actual).all() and not actual.requires_grad
    for k,v in before.items():torch.testing.assert_close(g.model.state_dict()[k],v,rtol=0,atol=0)


def test_invalid_endpoint_and_schedule_admission():
    g=generator()
    rng=torch.get_rng_state().clone()
    with pytest.raises(ValueError):g.generate((1,2,2),num_steps=3,start_point=torch.zeros(1,2))
    assert torch.equal(rng,torch.get_rng_state())
    g.alpha_bars[3]=float('nan')
    with pytest.raises(ValueError):g.generate((1,2,2),num_steps=3)
    assert torch.equal(rng,torch.get_rng_state())
