from typing import TypedDict

REGION_PERMISSION_PREFIX = "api.analytics_view_region_"
GLOBAL_PERMISSION = "api.analytics_view_global"
LIVE_PERMISSION = "api.analytics_view_live"


class AnalyticsAccess(TypedDict):
    global_access: bool
    live_access: bool
    region_codes: list[str]


def get_region_codes_from_permissions(user) -> list[str]:
    perms = user.get_all_permissions()
    region_codes = {
        perm.replace(REGION_PERMISSION_PREFIX, "", 1)
        for perm in perms
        if perm.startswith(REGION_PERMISSION_PREFIX)
    }
    return sorted(region_codes)


def get_analytics_access(user) -> AnalyticsAccess:
    return {
        "global_access": user.has_perm(GLOBAL_PERMISSION),
        "live_access": user.has_perm(LIVE_PERMISSION),
        "region_codes": get_region_codes_from_permissions(user),
    }
