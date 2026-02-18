from dataclasses import dataclass
from typing import Literal, TypedDict

MODULE_OVERVIEW = "overview"
MODULE_VIEWS_BY_DATE = "views_by_date"
MODULE_TOP_PAGES = "top_pages"
MODULE_TOP_COUNTRIES = "top_countries"
MODULE_LIVE_MONITORING = "live_monitoring"
MODULE_MAP_HEATMAP = "map_heatmap"
MODULE_ENGAGEMENT_PERFORMANCE = "engagement_performance"
MODULE_AUDIENCE_INSIGHTS = "audience_insights"
MODULE_LIVE_SPIKES = "live_spikes"
MODULE_PLATFORM_ADOPTION = "platform_adoption"
MODULE_ENGAGEMENT_COMPARISON = "engagement_comparison"
MODULE_METADATA_LOOKUP = "metadata_lookup"

RoleName = Literal["regional_im", "ops_im", "global_im", "country_im"]


class RoleProfile(TypedDict):
    role: RoleName
    realtime_enabled: bool
    historical_depth: Literal["30_days", "multi_year"]


@dataclass(frozen=True)
class AnalyticsModule:
    key: str
    label: str
    allowed_roles: tuple[RoleName, ...]


MODULES = (
    AnalyticsModule(
        key=MODULE_OVERVIEW,
        label="Overview",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_VIEWS_BY_DATE,
        label="Views by date",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_MAP_HEATMAP,
        label="Map",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_ENGAGEMENT_PERFORMANCE,
        label="Engagement performance",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_AUDIENCE_INSIGHTS,
        label="Audience insights",
        allowed_roles=("regional_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_LIVE_MONITORING,
        label="Live monitoring",
        allowed_roles=("ops_im",),
    ),
    AnalyticsModule(
        key=MODULE_LIVE_SPIKES,
        label="Live spikes",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_PLATFORM_ADOPTION,
        label="Platform adoption",
        allowed_roles=("regional_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_ENGAGEMENT_COMPARISON,
        label="Engagement comparison",
        allowed_roles=("regional_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_METADATA_LOOKUP,
        label="Metadata lookup",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_TOP_PAGES,
        label="Top pages",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
    AnalyticsModule(
        key=MODULE_TOP_COUNTRIES,
        label="Top countries",
        allowed_roles=("regional_im", "ops_im", "global_im", "country_im"),
    ),
)


def infer_role_profile(access: dict[str, object]) -> RoleProfile:
    if bool(access.get("global_access")):
        return {
            "role": "global_im",
            "realtime_enabled": False,
            "historical_depth": "multi_year",
        }

    if bool(access.get("live_access")):
        return {
            "role": "ops_im",
            "realtime_enabled": True,
            "historical_depth": "30_days",
        }

    # NOTE: Country-level access can later be inferred from country-specific permissions.
    if bool(access.get("region_codes")):
        return {
            "role": "regional_im",
            "realtime_enabled": False,
            "historical_depth": "multi_year",
        }

    return {
        "role": "country_im",
        "realtime_enabled": False,
        "historical_depth": "multi_year",
    }


def get_available_modules(role: RoleName) -> list[str]:
    return [
        module.key
        for module in MODULES
        if role in module.allowed_roles
    ]
