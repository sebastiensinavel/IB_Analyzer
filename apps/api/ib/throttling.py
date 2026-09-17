"""IB allows 1 request per second and 10 per minute per token (spec §3.2).

We throttle per user rather than per token: the server never keys anything on
a token, not even a rate-limit bucket.

`UserRateThrottle` reads its rate from `THROTTLE_RATES[self.scope]`
(`ninja.throttling.SimpleRateThrottle.get_rate`) rather than from a plain
`rate` class attribute — `SimpleRateThrottle.__init__` only honours a `rate`
passed to the constructor, and these throttles are instantiated with none.
`get_rate()` is overridden below instead, and each throttle is also given its
own `scope`: with the inherited `scope = "user"` both throttles would build
the identical cache key `throttle_user_<id>`, and the two rate windows would
overwrite each other's history in the cache.
"""
from ninja.throttling import UserRateThrottle


class FlexBurstThrottle(UserRateThrottle):
    scope = "flex_burst"

    def get_rate(self):
        return "1/s"


class FlexRateThrottle(UserRateThrottle):
    scope = "flex_rate"

    def get_rate(self):
        return "10/min"
