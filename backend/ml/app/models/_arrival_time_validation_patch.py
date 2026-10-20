from datetime import datetime

from . import deadhead_eliminator as _deadhead_eliminator

_BaseFindReturnLoads = _deadhead_eliminator.find_return_loads


def find_return_loads(*args, **kwargs):
    arrival_time = kwargs.get('arrival_time')
    if arrival_time is None and len(args) >= 3:
        arrival_time = args[2]

    try:
        datetime.fromisoformat(arrival_time)
    except (ValueError, TypeError) as exc:
        raise ValueError("arrival_time must be a valid ISO-8601 timestamp") from exc

    return _BaseFindReturnLoads(*args, **kwargs)


_deadhead_eliminator.find_return_loads = find_return_loads
