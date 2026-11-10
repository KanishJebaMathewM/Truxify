"""Conservative, ordered shelf search; actual placement remains authoritative."""

import math

_EMPTY = (-math.inf,) * 4


def _upper_gap(limit: float, used: float) -> float:
    """Bound accepted additions even when a tiny positive item rounds away.

    Comparing an item to ``limit - used`` can wrongly reject an addition that
    rounds back to limit. Widen the limit before subtraction, then widen its
    rounded result. False positives are harmless: the shelf checks the fit.
    """
    return math.nextafter(math.nextafter(limit, math.inf) - used, math.inf)


class ShelfFitIndex:
    """Segment tree whose left-first search preserves first-fit shelf order.

    Coordinate maxima can come from different leaves, so pruning is only a
    necessary condition. Mixed geometry can still require linear leaf search.
    Storage is linear in the maximum number of shelves, bounded by packages.
    """

    def __init__(self, max_shelves: int, max_length: float):
        """Allocate a power-of-two tree for a single packing operation."""
        self.size = 1 << max(0, (max_shelves - 1).bit_length())
        self.max_length = max_length
        self.nodes = [_EMPTY] * (2 * self.size)

    def update(self, index: int, shelf, clearance: float) -> None:
        """Refresh a changed shelf's row bounds and fixed vertical clearance."""
        node = self.size + index
        if shelf.shelf_height > clearance:
            self.nodes[node] = _EMPTY
        else:
            self.nodes[node] = (
                _upper_gap(shelf.max_length, shelf.cursor_x),
                _upper_gap(shelf.max_width, shelf.cursor_y),
                _upper_gap(shelf.max_width, shelf.cursor_y + shelf.row_height),
                clearance,
            )
        node //= 2
        while node:
            left, right = self.nodes[2 * node], self.nodes[2 * node + 1]
            self.nodes[node] = tuple(max(a, b) for a, b in zip(left, right))
            node //= 2

    def find_first(self, dimensions: tuple[float, float, float], start: int = 0) -> int | None:
        """Find the earliest candidate at/after start across all six rotations."""
        length, width, height = dimensions
        orientations = (
            (length, width, height), (width, length, height),
            (length, height, width), (height, width, length),
            (width, height, length), (height, length, width),
        )

        def search(node: int, low: int, high: int) -> int | None:
            """Prune only if no orientation can meet the subtree bounds."""
            if high <= start:
                return None
            free_x, free_y, next_y, clearance = self.nodes[node]
            if not any(
                h <= clearance and (
                    (l <= free_x and w <= free_y)
                    or (l <= self.max_length and w <= next_y)
                )
                for l, w, h in orientations
            ):
                return None
            if high - low == 1:
                return low
            middle = (low + high) // 2
            result = search(2 * node, low, middle)
            if result is not None:
                return result
            return search(2 * node + 1, middle, high)

        return search(1, 0, self.size)
