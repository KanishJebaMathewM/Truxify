"""Private validation for native multi-task model/Adam/scheduler generations."""
import math

import torch


def scalar(value, name, *, minimum=0, maximum=None):
    if (type(value) not in (int, float) or not math.isfinite(value) or value < minimum
            or (maximum is not None and value >= maximum)):
        raise ValueError(f"invalid MTL checkpoint {name}")


def validate_generation(model, optimizer, scheduler, checkpoint):
    if (not isinstance(checkpoint, dict) or not {'model_state_dict','optimizer_state_dict','task_config'} <= checkpoint.keys()
            or not checkpoint.keys() <= {'model_state_dict','optimizer_state_dict','task_config','scheduler_state_dict'}):
        raise ValueError("MTL checkpoint must contain a compatible complete generation")
    if checkpoint['task_config'] != model.tasks:
        raise ValueError("MTL checkpoint task configuration must match the configured heads")
    state, expected = checkpoint['model_state_dict'], model.state_dict()
    if not isinstance(state, dict) or state.keys() != expected.keys():
        raise ValueError("MTL checkpoint model keys do not match")
    for name, reference in expected.items():
        value = state[name]
        if (not isinstance(value, torch.Tensor) or value.shape != reference.shape
                or value.dtype != reference.dtype or not torch.isfinite(value).all()):
            raise ValueError("MTL checkpoint model tensors must match and remain finite")
    adam = checkpoint['optimizer_state_dict']
    if not isinstance(adam, dict) or set(adam) != {'state','param_groups'}:
        raise ValueError("MTL checkpoint requires compatible Adam state")
    reference = optimizer.state_dict()['param_groups']
    groups = adam['param_groups']
    if not isinstance(groups, list) or len(groups) != 1 or len(reference) != 1:
        raise ValueError("MTL Adam requires one native parameter group")
    group = groups[0]
    if (not isinstance(group, dict) or set(group) != set(reference[0])
            or group['params'] != reference[0]['params']
            or any(type(value) is not int for value in group['params'])):
        raise ValueError("MTL Adam parameter schema/order must match")
    for name in ('lr','eps','weight_decay'):
        scalar(group[name],name)
    betas = group['betas']
    if not isinstance(betas,(list,tuple)) or len(betas) != 2:
        raise ValueError("MTL Adam betas must be a pair")
    for value in betas:
        scalar(value,'beta',maximum=1)
    for name in ('amsgrad','maximize','capturable','differentiable','decoupled_weight_decay'):
        if name in group and type(group[name]) is not bool:
            raise ValueError("MTL Adam flags must be boolean")
    if group.get('capturable') or group.get('differentiable') or group.get('decoupled_weight_decay'):
        raise ValueError("MTL checkpoint uses unsupported Adam execution modes")
    for name in ('foreach','fused'):
        if group.get(name) is not None and type(group[name]) is not bool:
            raise ValueError("MTL Adam execution flags must be boolean or None")
    if group.get('foreach') and group.get('fused'):
        raise ValueError("MTL Adam execution flags are incompatible")
    by_id = dict(zip(group['params'],optimizer.param_groups[0]['params']))
    if (not isinstance(adam['state'],dict) or any(type(key) is not int for key in adam['state'])
            or not adam['state'].keys() <= by_id.keys()):
        raise ValueError("MTL Adam state references unknown parameters")
    for identifier, entry in adam['state'].items():
        names = {'step','exp_avg','exp_avg_sq'} | ({'max_exp_avg_sq'} if group['amsgrad'] else set())
        if not isinstance(entry,dict) or set(entry) != names:
            raise ValueError("MTL Adam moment schema does not match")
        step = entry['step']
        if (not isinstance(step,torch.Tensor) or step.numel() != 1 or not torch.isfinite(step).all()
                or step.item() < 0 or step.item() != int(step.item())):
            raise ValueError("MTL Adam step must be a finite nonnegative integer scalar")
        parameter = by_id[identifier]
        for name in names - {'step'}:
            value = entry[name]
            if (not isinstance(value,torch.Tensor) or value.shape != parameter.shape
                    or value.dtype != parameter.dtype or not torch.isfinite(value).all()
                    or (name != 'exp_avg' and (value < 0).any())):
                raise ValueError("MTL Adam moments must match finite parameter tensors")
    model.load_state_dict(state,strict=True)
    optimizer.load_state_dict(adam)
    saved_scheduler = checkpoint.get('scheduler_state_dict')
    if 'scheduler_state_dict' not in checkpoint:
        # Legacy checkpoints did not capture history; do not retain another run's history.
        scheduler._last_lr = [entry['lr'] for entry in optimizer.param_groups]
        return
    expected_scheduler = scheduler.state_dict()
    if not isinstance(saved_scheduler,dict) or saved_scheduler.keys() != expected_scheduler.keys():
        raise ValueError("MTL scheduler schema does not match")
    if saved_scheduler['mode'] != 'min' or saved_scheduler['threshold_mode'] not in ('rel','abs'):
        raise ValueError("MTL scheduler policy is incompatible")
    scalar(saved_scheduler['factor'],'factor',maximum=1)
    for name in ('threshold','eps'):
        scalar(saved_scheduler[name],name)
    for name in ('patience','cooldown','cooldown_counter','last_epoch','num_bad_epochs'):
        value = saved_scheduler[name]
        if type(value) is not int or value < 0:
            raise ValueError("MTL scheduler counters must be nonnegative integers")
    for name in ('min_lrs','_last_lr'):
        values = saved_scheduler[name]
        if not isinstance(values,list) or len(values) != len(optimizer.param_groups):
            raise ValueError("MTL scheduler LR groups must match")
        for value in values:
            scalar(value,name)
    best = saved_scheduler['best']
    if (type(best) not in (int,float) or math.isnan(best) or best == -math.inf
            or saved_scheduler['mode_worse'] != math.inf):
        raise ValueError("MTL scheduler best/mode sentinel is incompatible")
    scheduler.load_state_dict(saved_scheduler)
