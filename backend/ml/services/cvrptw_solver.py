"""Bounded pickup/delivery feasibility search using great-circle travel estimates."""

import math
from fractions import Fraction
from numbers import Real
from typing import Any


def _finite(value, name, *, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise TypeError(f"{name} must be a finite real number")
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError(f"{name} must be float-representable") from exc
    if (
        not math.isfinite(result)
        or (minimum is not None and result < minimum)
        or (maximum is not None and result > maximum)
    ):
        raise ValueError(f"{name} is outside its finite range")
    return result


def haversine_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance, including antipodal floating-point boundaries."""
    d_lat, d_lng = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2.0) ** 2
    )
    a = min(1.0, max(0.0, a))
    return 6371.0 * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def _upper_float(value):
    """Round an exact accumulated nonnegative quantity outward for publication."""
    result = float(value)
    if not math.isfinite(result):
        raise OverflowError("route quantity exceeds finite float range")
    if Fraction.from_float(result) < value:
        result = math.nextafter(result, math.inf)
    if not math.isfinite(result):
        raise OverflowError("route quantity exceeds finite float range")
    return result


class CvrptwSolver:
    """Find the first feasible open itinerary; distance optimality is not claimed."""

    def __init__(
        self, avg_speed_kmh=45.0, service_time_mins=30.0, max_search_states=10000
    ):
        self.avg_speed_kmh = _finite(avg_speed_kmh, "speed", minimum=0)
        if self.avg_speed_kmh == 0:
            raise ValueError("speed must be positive")
        self.service_time_mins = _finite(service_time_mins, "service time", minimum=0)
        if type(max_search_states) is not int or not 1 <= max_search_states <= 100000:
            raise ValueError("search budget must be an integer in [1, 100000]")
        self.max_search_states = max_search_states

    def solve(
        self,
        depot: dict[str, Any],
        consignments: list[dict[str, Any]],
        max_capacity_kg: float = 25000.0,
    ) -> dict[str, Any]:
        # Revalidate public configuration attributes before admitting a problem.
        config = CvrptwSolver(
            self.avg_speed_kmh, self.service_time_mins, self.max_search_states
        )
        capacity = _finite(max_capacity_kg, "capacity", minimum=0)
        if not isinstance(depot, dict) or not isinstance(consignments, list):
            raise TypeError("depot and consignments must be a mapping and list")
        stops, weights, identities = [], [], set()
        for index, consignment in enumerate(consignments):
            if not isinstance(consignment, dict):
                raise TypeError("each consignment must be a mapping")
            identity = consignment.get("id", f"c_{index}")
            if (
                type(identity) not in (str, int)
                or (isinstance(identity, str) and not identity.strip())
                or identity in identities
            ):
                raise ValueError(
                    "consignment IDs must be unique nonempty strings or integers"
                )
            identities.add(identity)
            weight = _finite(consignment.get("weight_kg", 0), "weight", minimum=0)
            weights.append(Fraction.from_float(weight))
            for kind, key in (("PICKUP", "pickup"), ("DELIVERY", "delivery")):
                location = consignment.get(key)
                if not isinstance(location, dict):
                    raise TypeError("pickup and delivery locations are required")
                lat = _finite(location.get("lat"), "latitude", minimum=-90, maximum=90)
                lng = _finite(
                    location.get("lng"), "longitude", minimum=-180, maximum=180
                )
                start = _finite(
                    location.get("time_window_start_min", 0), "window start", minimum=0
                )
                end = _finite(
                    location.get("time_window_end_min", 1440), "window end", minimum=0
                )
                if start > end:
                    raise ValueError("time window start must not exceed end")
                name = location.get("name")
                if name is not None and not isinstance(name, str):
                    raise TypeError("stop name must be a string or None")
                stops.append(
                    {
                        "consignment_id": identity,
                        "job": index,
                        "type": kind,
                        "lat": lat,
                        "lng": lng,
                        "name": name or f"{kind.title()} #{identity}",
                        "tw_start": Fraction.from_float(start),
                        "tw_end": Fraction.from_float(end),
                    }
                )
        initial_lat = _finite(
            depot.get("lat", stops[0]["lat"] if stops else 0),
            "depot latitude",
            minimum=-90,
            maximum=90,
        )
        initial_lng = _finite(
            depot.get("lng", stops[0]["lng"] if stops else 0),
            "depot longitude",
            minimum=-180,
            maximum=180,
        )
        initial_time = Fraction.from_float(
            _finite(depot.get("start_time_min", 0), "start time", minimum=0)
        )
        capacity_exact = Fraction.from_float(capacity)
        service = Fraction.from_float(config.service_time_mins)
        complete = (1 << len(weights)) - 1
        numeric_limit = False

        def result(
            success,
            reason,
            path=None,
            distance=Fraction(0),
            end_time=initial_time,
            states=0,
        ):
            itinerary = []
            while path is not None:
                entry, path = path
                itinerary.append(entry)
            itinerary.reverse()
            return {
                "success": success,
                "reason": reason,
                "itinerary": itinerary,
                "stops": list(itinerary),
                "total_stops": len(itinerary),
                "consignments_count": len(weights),
                "max_capacity_kg": capacity,
                "total_distance_km": _upper_float(distance),
                "total_duration_mins": _upper_float(end_time - initial_time),
                "total_duration_hours": _upper_float((end_time - initial_time) / 60),
                "search_states": states,
            }

        if any(weight > capacity_exact for weight in weights):
            return result(False, "infeasible")
        if not weights:
            return result(True, "feasible", states=1)

        # State: picked mask, delivered mask, last stop, exact clock/load/distance,
        # and owned itinerary. Earlier arrival dominates a later identical state
        # for static travel and service-start windows, independent of distance.
        root = (0, 0, -1, initial_time, Fraction(0), Fraction(0), None)
        earliest = {(0, 0, -1): initial_time}

        def transitions(state):
            nonlocal numeric_limit
            picked, delivered, last, clock, load, distance, path = state
            lat = initial_lat if last == -1 else stops[last]["lat"]
            lng = initial_lng if last == -1 else stops[last]["lng"]
            candidates = []
            for stop_index, stop in enumerate(stops):
                bit = 1 << stop["job"]
                if stop["type"] == "PICKUP":
                    if picked & bit:
                        continue
                    next_load = load + weights[stop["job"]]
                    if next_load > capacity_exact:
                        continue
                    next_picked, next_delivered = picked | bit, delivered
                else:
                    if not picked & bit or delivered & bit:
                        continue
                    next_load = load - weights[stop["job"]]
                    next_picked, next_delivered = picked, delivered | bit
                leg = haversine_distance_km(lat, lng, stop["lat"], stop["lng"])
                travel = (leg / config.avg_speed_kmh) * 60
                if not math.isfinite(travel):
                    numeric_limit = True
                    continue
                arrival = clock + Fraction.from_float(travel)
                start_service = max(arrival, stop["tw_start"])
                if start_service > stop["tw_end"]:
                    continue
                departure = start_service + service
                next_distance = distance + Fraction.from_float(leg)
                try:
                    entry = {
                        "sequence": picked.bit_count() + delivered.bit_count() + 1,
                        "consignment_id": stop["consignment_id"],
                        "type": stop["type"],
                        "name": stop["name"],
                        "location": {"lat": stop["lat"], "lng": stop["lng"]},
                        "distance_from_prev_km": leg,
                        "arrival_time_min": _upper_float(arrival),
                        "start_service_time_min": _upper_float(start_service),
                        "departure_time_min": _upper_float(departure),
                        "vehicle_load_kg": _upper_float(next_load),
                        "is_within_time_window": True,
                    }
                    _upper_float(next_distance)
                except OverflowError:
                    numeric_limit = True
                    continue
                child = (
                    next_picked,
                    next_delivered,
                    stop_index,
                    departure,
                    next_load,
                    next_distance,
                    (entry, path),
                )
                candidates.append((leg, stop_index, child))
            candidates.sort(key=lambda candidate: candidate[:2])
            return iter(child for _, _, child in candidates)

        # Explicit frames avoid recursion limits and admit one child
        # at a time, so nearest-first work cannot consume its budget on siblings.
        stack = [transitions(root)]
        admitted = 1
        while stack:
            child = next(stack[-1], None)
            if child is None:
                stack.pop()
                continue
            picked, delivered, last, clock, _, distance, path = child
            key = picked, delivered, last
            if key in earliest and earliest[key] <= clock:
                continue
            if admitted >= config.max_search_states:
                return result(False, "search_limit", states=admitted)
            admitted += 1
            earliest[key] = clock
            if delivered == complete:
                return result(True, "feasible", path, distance, clock, admitted)
            stack.append(transitions(child))
        return result(
            False, "numeric_limit" if numeric_limit else "infeasible", states=admitted
        )
