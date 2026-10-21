"""Native objective versus prediction contracts, exact gradients and ASGI."""
import copy

import httpx
import pytest
import torch
from fastapi import FastAPI
from mtl.model import MTLLoss, MultiTaskModel, MultiTaskTrainer
from torch import nn


def native(mixed=False,bias=(10.,-10.)):
    tasks={'risk':{'output_dim':2,'type':'classification'}}
    if mixed:tasks['eta']={'output_dim':1,'type':'regression'}
    model=MultiTaskModel(2,tasks,hidden_dim=8)
    for module in model.modules():
        if isinstance(module,nn.Dropout):module.p=0
    with torch.no_grad():
        for p in model.parameters():p.zero_()
        model.task_heads['risk'].head[-2].bias.copy_(torch.tensor(bias))
    losses={'risk':nn.CrossEntropyLoss()}
    if mixed:losses['eta']=nn.MSELoss()
    trainer=MultiTaskTrainer(model,MTLLoss(losses),device='cpu')
    trainer.gradient_method='standard'
    return model,trainer


@pytest.mark.parametrize('bias,labels',[((10.,-10.),[1,1]),((-10.,10.),[0,0]),((.8,-.3),[0,1]),((1000.,-1000.),[1,1])])
def test_native_training_exact_logit_loss_and_bias_gradient(bias,labels):
    model,t=native(bias=bias)
    expected=torch.tensor(bias,requires_grad=True)
    y=torch.tensor(labels)
    loss=nn.functional.cross_entropy(expected.expand(len(y),-1),y)
    loss.backward()
    t.optimizer.step=lambda:None
    result=t.train_step(torch.zeros(len(y),2),{'risk':y})
    assert result['task_losses']['risk']==pytest.approx(loss.item(),rel=1e-6)
    torch.testing.assert_close(model.task_heads['risk'].head[-2].bias.grad,expected.grad)


def test_native_validation_uses_same_exact_objective():
    model,t=native()
    assert t.validate(torch.zeros(2,2),{'risk':torch.tensor([1,1])})==pytest.approx(20.)


def test_public_probability_and_regression_paths_remain_compatible():
    model,t=native(mixed=True)
    model.eval();x=torch.randn(3,2)
    public=model(x);loss=model.forward_for_loss(x);pred=t.predict(x)
    torch.testing.assert_close(public['risk'],torch.softmax(loss['risk'],-1))
    torch.testing.assert_close(pred['risk'],public['risk'])
    torch.testing.assert_close(model.forward_single_task(x,'risk'),public['risk'])
    torch.testing.assert_close(public['eta'],loss['eta'])
    torch.testing.assert_close(pred['eta'],public['eta'])


def test_loss_forward_shares_one_encoder_evaluation():
    model,t=native(mixed=True)
    calls=[]
    hook=model.shared_encoder.register_forward_hook(lambda *_:calls.append(1))
    try:result=model.forward_for_loss(torch.zeros(3,2))
    finally:hook.remove()
    assert calls==[1] and set(result)=={'risk','eta'}


def test_native_optimizer_corrects_saturated_wrong_class():
    model,t=native()
    before=model.task_heads['risk'].head[-2].bias.detach().clone()
    t.train_step(torch.zeros(2,2),{'risk':torch.tensor([1,1])})
    after=model.task_heads['risk'].head[-2].bias
    assert after[0]<before[0] and after[1]>before[1]
    assert t.optimizer.state and all(torch.isfinite(p).all() for p in model.parameters())


def test_checkpoint_keys_roundtrip_and_prediction_probabilities(tmp_path):
    model,t=native(mixed=True)
    keys=list(model.state_dict())
    prior=copy.deepcopy(model.state_dict())
    t.train_step(torch.zeros(2,2),{'risk':torch.tensor([1,1]),'eta':torch.ones(2,1)})
    assert list(model.state_dict())==keys
    path=tmp_path/'native.pth';t.save(path)
    restored,other=native(mixed=True);other.load(path)
    # Loading publishes a private validated generation; refresh the consumer reference.
    restored=other.model
    for k,v in model.state_dict().items():torch.testing.assert_close(v,restored.state_dict()[k])
    torch.testing.assert_close(other.predict(torch.zeros(2,2))['risk'].sum(-1),torch.ones(2))
    assert list(prior)==list(restored.state_dict())


@pytest.mark.asyncio
async def test_actual_asgi_native_mixed_train_and_probability_predict(monkeypatch):
    from routes import mtl_routes as r
    model=MultiTaskModel(2,r.tasks,hidden_dim=8)
    trainer=MultiTaskTrainer(model,MTLLoss(r.task_losses),device='cpu')
    # Independent PCGrad coordinate regression is covered by published17169;
    # use the native standard optimizer path to isolate this objective.
    trainer.gradient_method='standard'
    monkeypatch.setattr(r,'model',model);monkeypatch.setattr(r,'trainer',trainer)
    monkeypatch.setattr(r,'input_dim',2)
    app=FastAPI();app.include_router(r.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
        response=await c.post('/mtl/train',json={'epochs':1,'batch_size':2,'data_size':5})
        assert response.status_code==200,response.text
        prediction=await c.post('/mtl/predict',json=[[0.,0.],[1.,1.]])
        assert prediction.status_code==200,prediction.text
        # Actual route serializes the preserved public probability outputs.
        values=prediction.json()['data']['risk']
        torch.testing.assert_close(torch.tensor(values).sum(-1),torch.ones(2))
    assert trainer.optimizer.state
