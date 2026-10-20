from . import bin_packing as _bin_packing

_BaseOptimisePacking = _bin_packing.optimise_packing


def optimise_packing(packages, truck, delivery_addresses, route_start):
    if packages and len(delivery_addresses) != len(packages):
        raise ValueError("delivery_addresses must contain exactly one address per package")
    return _BaseOptimisePacking(packages, truck, delivery_addresses, route_start)


_bin_packing.optimise_packing = optimise_packing
