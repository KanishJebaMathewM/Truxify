"""Native categorical numerical loss, optimizer integrity and row ownership."""
import copy

import httpx
import numpy as np
import pytest
import torch
from fastapi import FastAPI

from imitation.model import PolicyGradient


def policy(bias=(1.,-1.)):
    p=PolicyGradient(state_dim=2,action_dim=2,hidden_dim=8)
    with torch.no_grad():
        for v in p.policy.parameters():v.zero_()
        p.policy[-2].bias.copy_(torch.tensor(bias))
    return p


def test_saturated_logits_preserve_exact_loss_and_finite_adam_step():
    p=policy((1000.,-1000.))
    assert p.train_step(np.zeros((2,2)),np.ones(2,dtype=int),np.ones(2))==pytest.approx(2000.)
    assert all(torch.isfinite(v).all() for v in p.policy.parameters())
    assert all(torch.isfinite(v).all() for state in p.optimizer.state.values() for v in state.values())
    assert p.policy[-2].bias.grad[1]<0


@pytest.mark.parametrize('count',[1,2,5])
def test_exact_paired_loss_and_gradient_for_column_rewards(count):
    p=policy((.8,-.3))
    reference=p.policy[-2].bias.detach().clone().requires_grad_(True)
    actions=torch.arange(count)%2
    rewards=torch.arange(1,count+1,dtype=torch.float32)*.03
    exact=-(torch.log_softmax(reference,dim=0)[actions]*rewards).mean()
    exact.backward()
    got=p.train_step(np.zeros((count,2)),actions.numpy(),rewards[:,None].numpy())
    assert got==pytest.approx(exact.item(),rel=1e-6)
    torch.testing.assert_close(p.policy[-2].bias.grad,reference.grad)


def test_unweighted_zero_reward_extreme_action_has_zero_finite_loss():
    p=policy((1000.,-1000.))
    assert p.train_step(np.zeros((1,2)),np.array([1]),np.array([0.]))==0
    assert all(torch.isfinite(v).all() for v in p.policy.parameters())


@pytest.mark.parametrize('states,actions,rewards', [
    (np.ones((2,3)),[0,1],[1,1]),(np.ones((2,2)),[0],[1,1]),
    (np.ones((2,2)),[0,1],[1]),(np.ones((2,2)),[0,2],[1,1]),
    (np.ones((2,2)),[-1,0],[1,1]),(np.ones((2,2)),[0,.5],[1,1]),
    (np.ones((2,2)),[0,np.nan],[1,1]),(np.ones((2,2)),[0,1],[1,np.inf]),
    (np.full((2,2),np.nan),[0,1],[1,1]),(np.empty((0,2)),[],[]),
    (np.ones((2,2)),[[0],[1]],[1,1]),(np.ones((2,2)),[0,1],[[1,2],[3,4]]),
])
def test_bad_batch_preserves_model_and_optimizer(states,actions,rewards):
    p=policy()
    before=copy.deepcopy(p.policy.state_dict())
    with pytest.raises(ValueError):p.train_step(states,np.array(actions),np.array(rewards))
    assert not p.optimizer.state
    for k,v in before.items():torch.testing.assert_close(v,p.policy.state_dict()[k])


def test_nonfinite_native_logits_never_update_adam():
    p=policy((float('inf'),0.))
    with pytest.raises(ValueError,match='logits'):p.train_step(np.zeros((1,2)),np.array([1]),np.ones(1))
    assert not p.optimizer.state


def test_unrepresentable_objective_never_updates_adam():
    p=policy((1e20,-1e20))
    with pytest.raises(ValueError,match='objective'):p.train_step(np.zeros((1,2)),np.array([1]),np.array([1e20]))
    assert not p.optimizer.state


def test_full_trajectory_preflight_before_any_update():
    p=policy()
    good={'states':[[0,0],[1,1]],'actions':[0,1],'rewards':[1,2]}
    bad={'states':[[2,2],[3,3]],'actions':[0],'rewards':[3,4]}
    with pytest.raises(ValueError):p.train([good,bad],epochs=2,batch_size=1)
    assert not p.optimizer.state


def test_joint_trajectory_shuffle_singleton_tail_preserves_credit(monkeypatch):
    p=policy()
    seen=[]
    original=p.train_step
    def paired(states,actions,rewards):
        ids=states[:,0].astype(int)
        np.testing.assert_array_equal(actions,ids%2)
        seen.extend(ids.tolist())
        return original(states,actions,rewards)
    monkeypatch.setattr(p,'train_step',paired)
    traj={'states':[[i,i] for i in range(5)],'actions':[i%2 for i in range(5)],'rewards':[[i+1] for i in range(5)]}
    result=p.train([traj],epochs=2,batch_size=2)
    assert sorted(seen)==[0,0,1,1,2,2,3,3,4,4]
    assert all(np.isfinite(result['losses']))


def test_checkpoint_keys_and_public_policy_probabilities_unchanged():
    p=policy()
    keys=list(p.policy.state_dict())
    before=copy.deepcopy(p.policy.state_dict())
    p.train_step(np.zeros((2,2)),np.array([0,1]),np.ones(2))
    assert list(p.policy.state_dict())==keys
    restored=policy()
    restored.policy.load_state_dict(before)
    torch.testing.assert_close(restored.policy(torch.zeros(2,2)).sum(-1),torch.ones(2))


@pytest.mark.asyncio
async def test_actual_mounted_policy_train_native_optimizer(monkeypatch):
    from routes import imitation_routes as r
    p=policy()
    monkeypatch.setattr(r.model,'policy_gradient',p)
    # Actual handler still constructs ten local native synthetic trajectories.
    # Match the request module's dimensions to the small real policy.
    monkeypatch.setattr(r,'state_dim',2)
    monkeypatch.setattr(r,'action_dim',2)
    app=FastAPI()
    app.include_router(r.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        response=await client.post('/imitation/train/policy',json={'epochs':1})
        assert response.status_code==200,response.text
        assert np.isfinite(response.json()['data']['final_loss'])
    assert p.optimizer.state
