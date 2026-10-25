"""Actual native MTL model/Adam/scheduler continuation and publication ownership."""
import copy
import importlib.util
import sys
import threading
from pathlib import Path

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from mtl.model import MTLLoss, MultiTaskModel, MultiTaskTrainer


def trainer():
    torch.manual_seed(17783)
    model=MultiTaskModel(2,{'eta':{'output_dim':1,'type':'regression'},'risk':{'output_dim':2,'type':'classification'}},4)
    return MultiTaskTrainer(model,MTLLoss({'eta':torch.nn.MSELoss(),'risk':torch.nn.CrossEntropyLoss()}),device='cpu')


def batch():
    return torch.tensor([[1.,2.],[2.,3.]]),{'eta':torch.tensor([[1.],[2.]]),'risk':torch.tensor([0,1])}


def equal(left,right):
    if isinstance(left,torch.Tensor):
        assert torch.equal(left,right)
    elif isinstance(left,dict):
        assert left.keys()==right.keys()
        for key in left:equal(left[key],right[key])
    elif isinstance(left,(list,tuple)):
        assert len(left)==len(right)
        for a,b in zip(left,right):equal(a,b)
    else:assert left==right


def capture(item):
    return copy.deepcopy((item.model.state_dict(),item.optimizer.state_dict(),item.scheduler.state_dict()))


def warmed():
    item=trainer();item.train_step(*batch());item.scheduler.patience=1
    for metric in [1.,2.,3.]:item._step_scheduler(metric)
    return item


def test_valid_native_model_adam_scheduler_continuation_matches_uninterrupted_reference(tmp_path):
    left=warmed();path=tmp_path/'mtl.pth';left.save(path)
    right=trainer();right.load(path)
    equal(capture(left),capture(right));assert right.scheduler.optimizer is right.optimizer
    assert all(a is b for a,b in zip(right.model.parameters(),right.optimizer.param_groups[0]['params']))
    torch.manual_seed(100);a=left.train_step(*batch())
    torch.manual_seed(100);b=right.train_step(*batch())
    equal(a,b);left._step_scheduler(4.);right._step_scheduler(4.);equal(capture(left),capture(right))


@pytest.mark.parametrize('fault',['adam_schema','model_nan','model_shape','model_dtype','moment_nan','moment_shape',
    'unknown_parameter','negative_variance','learning_rate','betas','task_config','scheduler_schema','scheduler_nan',
    'scheduler_counter','scheduler_groups','scheduler_mode','unsupported_flags'])
def test_rejected_private_generation_preserves_all_live_native_state_and_predictions(tmp_path,fault):
    item=warmed();path=tmp_path/'valid.pth';item.save(path)
    checkpoint=torch.load(path,weights_only=True)
    for value in checkpoint['model_state_dict'].values():value.fill_(7.)
    first=next(iter(checkpoint['model_state_dict']))
    adam=checkpoint['optimizer_state_dict'];identifier=next(iter(adam['state']))
    if fault=='adam_schema':checkpoint['optimizer_state_dict']={'invalid':True}
    elif fault=='model_nan':checkpoint['model_state_dict'][first].fill_(float('nan'))
    elif fault=='model_shape':checkpoint['model_state_dict'][first]=torch.zeros(1)
    elif fault=='model_dtype':checkpoint['model_state_dict'][first]=checkpoint['model_state_dict'][first].double()
    elif fault=='moment_nan':adam['state'][identifier]['exp_avg'].fill_(float('nan'))
    elif fault=='moment_shape':adam['state'][identifier]['exp_avg_sq']=torch.zeros(1)
    elif fault=='unknown_parameter':adam['state'][999]={}
    elif fault=='negative_variance':adam['state'][identifier]['exp_avg_sq'].fill_(-1.)
    elif fault=='learning_rate':adam['param_groups'][0]['lr']=float('inf')
    elif fault=='betas':adam['param_groups'][0]['betas']=(0.9,1.)
    elif fault=='task_config':checkpoint['task_config']['risk']['type']='regression'
    elif fault=='scheduler_schema':checkpoint['scheduler_state_dict']={'best':0.}
    elif fault=='scheduler_nan':checkpoint['scheduler_state_dict']['best']=float('nan')
    elif fault=='scheduler_counter':checkpoint['scheduler_state_dict']['num_bad_epochs']=-1
    elif fault=='scheduler_groups':checkpoint['scheduler_state_dict']['min_lrs']=[]
    elif fault=='scheduler_mode':checkpoint['scheduler_state_dict']['mode']='max'
    elif fault=='unsupported_flags':adam['param_groups'][0]['capturable']=True
    corrupt=tmp_path/'bad.pth';torch.save(checkpoint,corrupt)
    before=capture(item);identity=(item.model,item.optimizer,item.scheduler);predictions=item.predict(batch()[0])
    with pytest.raises(ValueError):item.load(corrupt)
    assert (item.model,item.optimizer,item.scheduler)==identity
    equal(capture(item),before);equal(item.predict(batch()[0]),predictions)


def test_valid_legacy_pair_resets_scheduler_history_explicitly(tmp_path):
    left=warmed();path=tmp_path/'mtl.pth';left.save(path);checkpoint=torch.load(path,weights_only=True)
    checkpoint.pop('scheduler_state_dict');torch.save(checkpoint,path)
    right=warmed();right.load(path)
    equal(right.model.state_dict(),left.model.state_dict());equal(right.optimizer.state_dict(),left.optimizer.state_dict())
    assert right.scheduler.num_bad_epochs==0;assert right.scheduler.last_epoch==0
    assert right.scheduler.best==float('inf');assert right.scheduler._last_lr==[right.optimizer.param_groups[0]['lr']]
    assert right.scheduler.optimizer is right.optimizer


def test_actual_predictions_are_no_grad_deterministic_and_preserve_mixed_module_modes():
    item=trainer();item.model.train();item.model.task_heads['eta'].eval()
    modes=[m.training for m in item.model.modules()]
    all_tasks=item.predict(batch()[0]);single=item.predict(batch()[0],task_name='risk')
    assert all(not value.requires_grad for value in all_tasks.values());assert not single.requires_grad
    equal(single,all_tasks['risk']);equal(item.predict(batch()[0]),all_tasks)
    assert [m.training for m in item.model.modules()]==modes
    with pytest.raises(ValueError):item.predict(batch()[0],task_name='missing')
    assert [m.training for m in item.model.modules()]==modes


def test_save_failure_preserves_prior_file_and_removes_own_partial_temp(tmp_path,monkeypatch):
    item=warmed();path=tmp_path/'mtl.pth';item.save(path);before=path.read_bytes()
    real_save=torch.save
    def failing_native_serialization(value,output):
        real_save(value,output);output.write(b'partial-extra');raise OSError('controlled serialization failure')
    with monkeypatch.context() as patch:
        patch.setattr(torch,'save',failing_native_serialization)
        with pytest.raises(OSError):item.save(path)
    assert path.read_bytes()==before;assert list(tmp_path.glob('.mtl-*.tmp'))==[]
    item.save(path);assert path.read_bytes()


def test_native_training_holds_generation_against_concurrent_checkpoint_capture(tmp_path):
    item=trainer();entered=threading.Event();release=threading.Event();done=threading.Event();errors=[]
    once=False
    def hold_native_forward(module,arguments):
        nonlocal once
        if not once:
            once=True;entered.set();assert release.wait(3)
    handle=item.model.shared_encoder.encoder[0].register_forward_pre_hook(hold_native_forward)
    def training():
        try:item.train_step(*batch())
        except Exception as error:errors.append(error)  # noqa: BLE001 - relay all worker failures to the assertion
    def save():
        try:item.save(tmp_path/'owned.pth')
        except Exception as error:errors.append(error)  # noqa: BLE001 - relay all worker failures to the assertion
        finally:done.set()
    worker=threading.Thread(target=training);worker.start();assert entered.wait(3)
    reader=threading.Thread(target=save);reader.start();assert not done.wait(0.05)
    release.set();worker.join(3);reader.join(3);handle.remove()
    assert not errors and not worker.is_alive() and not reader.is_alive()
    restored=trainer();restored.load(tmp_path/'owned.pth');equal(capture(item),capture(restored))


def test_actual_single_task_route_uses_owned_native_no_grad_generation():
    spec=importlib.util.spec_from_file_location('native_mtl_checkpoint_routes',ROOT/'routes/mtl_routes.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.trainer=trainer();app=FastAPI();app.include_router(module.router)
    with TestClient(app) as client:
        a=client.post('/mtl/predict/task?task_name=risk',json=[[1.,2.],[2.,3.]])
        b=client.post('/mtl/predict/task?task_name=risk',json=[[1.,2.],[2.,3.]])
    assert a.status_code==200 and b.status_code==200
    assert a.json()['data']==b.json()['data']


def test_nonfinite_live_snapshot_cannot_replace_last_valid_file(tmp_path):
    item=warmed();path=tmp_path/'mtl.pth';item.save(path);before=path.read_bytes()
    with torch.no_grad():next(item.model.parameters()).fill_(float('nan'))
    with pytest.raises(ValueError):item.save(path)
    assert path.read_bytes()==before;assert list(tmp_path.glob('.mtl-*.tmp'))==[]


def test_restore_waits_for_actual_admitted_training_then_publishes_complete_generation(tmp_path):
    item=trainer();path=tmp_path/'replace.pth';item.save(path)
    checkpoint=torch.load(path,weights_only=True)
    for value in checkpoint['model_state_dict'].values():value.fill_(7.)
    torch.save(checkpoint,path)
    entered=threading.Event();release=threading.Event();done=threading.Event();errors=[];once=False
    old=item.model
    def hold(module,arguments):
        nonlocal once
        if not once:once=True;entered.set();assert release.wait(3)
    handle=old.shared_encoder.encoder[0].register_forward_pre_hook(hold)
    def update():
        try:item.train_step(*batch())
        except Exception as error:errors.append(error)  # noqa: BLE001 - relay worker errors
    def restore():
        try:item.load(path)
        except Exception as error:errors.append(error)  # noqa: BLE001 - relay worker errors
        finally:done.set()
    worker=threading.Thread(target=update);worker.start();assert entered.wait(3)
    loader=threading.Thread(target=restore);loader.start();assert not done.wait(0.05)
    release.set();worker.join(3);loader.join(3);handle.remove()
    assert not errors and not worker.is_alive() and not loader.is_alive()
    assert item.model is not old
    equal(item.model.state_dict(),checkpoint['model_state_dict'])
    assert item.scheduler.optimizer is item.optimizer


def test_serialization_owns_snapshot_while_training_can_advance(tmp_path,monkeypatch):
    item=warmed();before=capture(item);path=tmp_path/'owned.pth'
    entered=threading.Event();release=threading.Event();errors=[];real_save=torch.save
    def held_save(value,output):
        entered.set();assert release.wait(3);real_save(value,output)
    def capture_file():
        try:item.save(path)
        except Exception as error:errors.append(error)  # noqa: BLE001 - relay writer error
    with monkeypatch.context() as patch:
        patch.setattr(torch,'save',held_save)
        writer=threading.Thread(target=capture_file);writer.start();assert entered.wait(3)
        item.train_step(*batch());release.set();writer.join(3)
    assert not errors and not writer.is_alive()
    restored=trainer();restored.load(path);equal(capture(restored),before)


def test_explicit_null_scheduler_is_not_a_legacy_absent_history(tmp_path):
    item=warmed();path=tmp_path/'bad.pth';item.save(path)
    checkpoint=torch.load(path,weights_only=True);checkpoint['scheduler_state_dict']=None;torch.save(checkpoint,path)
    before=capture(item)
    with pytest.raises(ValueError):item.load(path)
    equal(capture(item),before)
