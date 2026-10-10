"""Genuinely trained observed-token predictions, ownership and native workers."""

import asyncio
import copy
import importlib
import json
import sys
import threading

import httpx
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from foundation import prediction_contract as contract
from foundation.data import LogisticsDataProcessor
from foundation.model import (
    FoundationModelConfig,
    FoundationModelTrainer,
    LogisticsFoundationModel,
)


def native(dtype=torch.float32):
    torch.manual_seed(33)
    config = FoundationModelConfig(vocab_size=8,d_model=8,num_heads=2,num_layers=1,d_ff=16,max_len=16,dropout=0,epochs=1,batch_size=2)
    model = LogisticsFoundationModel(vocab_size=8,d_model=8,num_heads=2,num_layers=1,d_ff=16,max_len=16,dropout=0).to(dtype)
    trainer = FoundationModelTrainer(model, config)
    trainer.train_step({'input_ids':torch.tensor([[0,1]]),'labels':torch.tensor([1])})
    processor = LogisticsDataProcessor(); processor.vocab = {'old':0,'word':1}
    return trainer,processor


@pytest.mark.parametrize('dtype',[torch.float32,torch.float64])
@pytest.mark.parametrize('task',['classification','regression'])
@pytest.mark.parametrize('text,ids',[('old',[0]),('old word',[0,1]),('WORD old WORD',[1,0,1])])
def test_trained_observed_native_head_reference_preserves_all_live_state(dtype,task,text,ids):
    t,p = native(dtype); reference = copy.deepcopy(t.model); reference.eval()
    with torch.no_grad(): logits = reference(torch.tensor([ids]),task=task)['output']
    t.model.eval(); t.model.layers[0].train()
    for parameter in t.model.parameters(): parameter.grad = torch.ones_like(parameter)
    modes = [m.training for m in t.model.modules()]
    grads = [v.grad.clone() for v in t.model.parameters()]
    weights = copy.deepcopy(t.model.state_dict()); optimizer = copy.deepcopy(t.optimizer.state_dict()); vocab=p.vocab.copy()
    observed = contract.predict_text(t.model,p,text,task,16)
    if task == 'classification':
        # Independent stable two-class normalization from the real native logits.
        centered = logits.double()[0] - logits.double()[0].max()
        exponentials = centered.exp(); expected = exponentials / exponentials.sum()
        assert observed['class'] == expected.argmax().item()
        torch.testing.assert_close(torch.tensor(observed['probabilities'],dtype=torch.float64),expected,rtol=1e-15,atol=1e-15)
    else: assert observed['value'] == logits[0,0].item()
    assert modes == [m.training for m in t.model.modules()]; assert p.vocab == vocab
    for a,b in zip(t.model.parameters(),grads): torch.testing.assert_close(a.grad,b,rtol=0,atol=0)
    for key,value in weights.items(): torch.testing.assert_close(t.model.state_dict()[key],value,rtol=0,atol=0)
    assert t.optimizer.state_dict()['param_groups'] == optimizer['param_groups']
    json.dumps(observed,allow_nan=False)


@pytest.mark.parametrize('bad',['unknown','unknown_tail','empty','whitespace','long','bool_id','duplicate_id','sparse_id','capacity','maxlen','task','budget'])
def test_complete_invalid_plan_preserves_mapping_modes_rng_and_skips_native_forward(monkeypatch,bad):
    t,p=native(); text='old word'; task='classification'; maxlen=16
    if bad=='unknown':text='old new'
    if bad=='unknown_tail':text='old word new';maxlen=1
    if bad=='empty':text=''
    if bad=='whitespace':text='  \n '
    if bad=='long':text='old '*3000
    if bad=='bool_id':p.vocab['old']=True
    if bad=='duplicate_id':p.vocab['word']=0
    if bad=='sparse_id':p.vocab['word']=3
    if bad=='capacity':p.vocab={str(i):i for i in range(9)};text='0'
    if bad=='maxlen':maxlen=17
    if bad=='task':task='generation'
    if bad=='budget':monkeypatch.setattr(contract,'MAX_WORK',1)
    before=p.vocab.copy();modes=[m.training for m in t.model.modules()];rng=torch.get_rng_state().clone();calls=[]
    handle=t.model.token_embedding.register_forward_hook(lambda *_:calls.append(1))
    try:
        with pytest.raises(contract.PredictionAdmissionError):contract.predict_text(t.model,p,text,task,maxlen)
    finally:handle.remove()
    assert not calls;assert p.vocab==before;assert modes==[m.training for m in t.model.modules()];assert torch.equal(rng,torch.get_rng_state())


def test_real_id_zero_and_prefix_length_are_observed_not_synthetic_padding():
    t,p=native(); ids,keep=contract.plan(t.model,p,'old word old','classification',2)
    assert ids.tolist()==[[0,1]];assert keep.tolist()==[[True,True]]
    a=contract.predict_text(t.model,p,'old word old','classification',2)
    b=contract.predict_text(t.model,p,'old word','classification',16)
    assert a==b


def test_native_nonfinite_head_restores_heterogeneous_modes_and_fails_publication():
    t,p=native();t.model.eval();t.model.layers[0].train(); modes=[m.training for m in t.model.modules()]
    with torch.no_grad():t.model.classification_head.bias.fill_(torch.inf)
    with pytest.raises(RuntimeError):contract.predict_text(t.model,p,'old word','classification',16)
    assert modes==[m.training for m in t.model.modules()]


@pytest.fixture
def mounted(monkeypatch):
    from foundation import model as source
    class Tiny(FoundationModelConfig):
        def __init__(self):super().__init__(vocab_size=8,d_model=8,num_heads=2,num_layers=1,d_ff=16,max_len=16,dropout=0,epochs=1,batch_size=2)
    monkeypatch.setattr(source,'FoundationModelConfig',Tiny)
    name='routes.foundation_routes'; previous=sys.modules.pop(name,None)
    route=importlib.import_module(name); route.processor.vocab={'old':0,'word':1}
    route.trainer.train_step({'input_ids':torch.tensor([[0,1]]),'labels':torch.tensor([1])})
    app=FastAPI();app.include_router(route.router)
    yield app,route
    sys.modules.pop(name,None)
    if previous is not None:sys.modules[name]=previous


def test_mounted_finite_native_results_and_typed_rejection(mounted):
    app,route=mounted;client=TestClient(app);vocab=route.processor.vocab.copy()
    for task in ('classification','regression'):
        expected=contract.predict_text(route.trainer.model,route.processor,'old word',task,16)
        response=client.post('/foundation/predict',params={'text':'old word','task':task})
        assert response.status_code==200;assert response.json()['data']==expected
        json.dumps(response.json(),allow_nan=False)
    for text in ('new','old word new','  '):
        assert client.post('/foundation/predict',params={'text':text}).status_code==422
        assert route.processor.vocab==vocab
    with torch.no_grad():route.trainer.model.regression_head.bias.fill_(torch.inf)
    response=client.post('/foundation/predict',params={'text':'old','task':'regression'})
    assert response.status_code==500;assert response.json()['detail']=='Internal server error'


@pytest.mark.asyncio
async def test_native_prediction_worker_retains_serial_ownership_through_cancellation(mounted,monkeypatch):
    app,route=mounted;entered=threading.Event();release=threading.Event();calls=[];original=route.trainer.model.forward
    @app.get('/probe')
    async def probe():return {'ready':True}
    loop_thread=threading.get_ident()
    def wait(*a,**kw):
        calls.append(threading.get_ident()); entered.set(); assert release.wait(5)
        return original(*a,**kw)
    monkeypatch.setattr(route.trainer.model,'forward',wait)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        first=asyncio.create_task(client.post('/foundation/predict?text=old'))
        assert await asyncio.to_thread(entered.wait,5)
        second=asyncio.create_task(client.post('/foundation/predict?text=word'))
        assert (await client.get('/probe')).json()=={'ready':True}
        first.cancel()
        with pytest.raises(asyncio.CancelledError):await first
        await asyncio.sleep(.01)
        assert len(calls)==1;assert not second.done()
        release.set();assert (await asyncio.wait_for(second,5)).status_code==200
    assert all(thread!=loop_thread for thread in calls)
