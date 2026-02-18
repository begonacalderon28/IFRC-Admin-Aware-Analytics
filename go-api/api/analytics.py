import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path

from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.analytics_access import get_analytics_access
from api.analytics_modules import (
    MODULE_AUDIENCE_INSIGHTS,
    MODULE_ENGAGEMENT_COMPARISON,
    MODULE_ENGAGEMENT_PERFORMANCE,
    MODULE_LIVE_MONITORING,
    MODULE_LIVE_SPIKES,
    MODULE_MAP_HEATMAP,
    MODULE_METADATA_LOOKUP,
    MODULE_OVERVIEW,
    MODULE_PLATFORM_ADOPTION,
    MODULE_TOP_COUNTRIES,
    MODULE_TOP_PAGES,
    MODULE_VIEWS_BY_DATE,
    get_available_modules,
    infer_role_profile,
)
from api.models import Country
from api.models import Event
from main.permissions import DenyGuestUserPermission

EVENT_URL_PATTERN = re.compile(r"/emergencies/(\d+)")
FACT_SHEET_NAME = "fact_views_daily_city"


def _find_dataset_path() -> Path:
    # Only use the new synthetic dataset.
    base_dir = Path(__file__).resolve().parents[1]
    candidates = [
        base_dir / "synthetic_ga_emergency_views.xlsx",
        base_dir.parent / "synthetic_ga_emergency_views.xlsx",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError("synthetic_ga_emergency_views.xlsx not found")


def _region_id_to_code(region_id: int) -> str | None:
    return {
        0: "africa",
        1: "americas",
        2: "asia-pacific",
        3: "europe",
        4: "middle-east-north-africa",
    }.get(region_id)


def _country_region_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for country in Country.objects.select_related("region").all():
        if country.name and country.region_id is not None:
            region_code = _region_id_to_code(country.region_id)
            if region_code:
                mapping[country.name.strip().lower()] = region_code
    return mapping


def _country_iso_region_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for country in Country.objects.select_related("region").all():
        if country.iso and country.region_id is not None:
            region_code = _region_id_to_code(country.region_id)
            if region_code:
                mapping[country.iso.strip().upper()] = region_code
    return mapping


def _country_iso_name_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for country in Country.objects.all():
        if country.iso and country.name:
            mapping[country.iso.strip().upper()] = country.name
    return mapping


def _country_iso3_region_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for country in Country.objects.select_related("region").all():
        if country.iso3 and country.region_id is not None:
            region_code = _region_id_to_code(country.region_id)
            if region_code:
                mapping[country.iso3.strip().upper()] = region_code
    return mapping


def _build_event_scope_map(event_ids: set[int]) -> dict[int, dict[str, set[str]]]:
    if not event_ids:
        return {}

    event_scope_map: dict[int, dict[str, set[str]]] = {}
    queryset = (
        Event.objects.filter(id__in=event_ids)
        .prefetch_related("regions", "countries__region")
    )
    for event in queryset:
        region_codes: set[str] = set()
        country_isos: set[str] = set()

        for region in event.regions.all():
            code = _region_id_to_code(region.name)
            if code:
                region_codes.add(code)

        for country in event.countries.all():
            if country.iso:
                country_isos.add(country.iso.strip().upper())
            if country.region_id is not None:
                code = _region_id_to_code(country.region_id)
                if code:
                    region_codes.add(code)

        event_scope_map[event.id] = {
            "regions": region_codes,
            "countries": country_isos,
        }

    return event_scope_map


def _infer_regions_from_emergency_name(
    emergency_name: str,
    country_name_region_map: dict[str, str],
    iso3_region_map: dict[str, str],
) -> set[str]:
    if not emergency_name:
        return set()

    regions: set[str] = set()
    lower_name = emergency_name.lower()

    iso3_match = re.match(r"^\s*([A-Za-z]{3})\s*:", emergency_name)
    if iso3_match:
        region = iso3_region_map.get(iso3_match.group(1).upper())
        if region:
            regions.add(region)

    region_markers = {
        "africa": "africa",
        "americas": "americas",
        "asia-pacific": "asia-pacific",
        "asia pacific": "asia-pacific",
        "europe": "europe",
        "mena": "middle-east-north-africa",
        "middle east": "middle-east-north-africa",
        "north africa": "middle-east-north-africa",
    }
    for marker, region_code in region_markers.items():
        if marker in lower_name:
            regions.add(region_code)

    for country_name, region_code in country_name_region_map.items():
        if len(country_name) < 4:
            continue
        if re.search(rf"\b{re.escape(country_name)}\b", lower_name):
            regions.add(region_code)

    return regions


def _is_active_emergency(row: dict) -> bool:
    value = str(row.get("is_active") or "").strip().lower()
    return value in {"yes", "true", "1", "y"}


def _parse_engagement_rate(value: str | None) -> float:
    try:
        return float(value or 0)
    except (ValueError, TypeError):
        return 0.0


def _parse_int(value, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _row_views(row: dict) -> int:
    return max(_parse_int(row.get("views"), 1), 0)


def _load_xlsx_rows(path: Path) -> list[dict]:
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[FACT_SHEET_NAME] if FACT_SHEET_NAME in workbook.sheetnames else workbook[workbook.sheetnames[-1]]
    rows = sheet.iter_rows(values_only=True)
    headers = [str(h).strip() if h is not None else "" for h in next(rows)]
    output: list[dict] = []
    for row in rows:
        values = dict(zip(headers, row))
        page_path = values.get("page_path")
        if not page_path:
            continue

        date_value = values.get("date")
        if isinstance(date_value, datetime):
            date_value = date_value.date().isoformat()
        elif isinstance(date_value, date):
            date_value = date_value.isoformat()
        else:
            date_value = str(date_value or "")

        output.append(
            {
                "date": date_value,
                "fullPageUrl": str(page_path),
                "emergency_name": str(values.get("emergency_name") or ""),
                "country": str(values.get("viewer_country") or ""),
                "viewer_city": str(values.get("viewer_city") or ""),
                "views": _parse_int(values.get("views"), 0),
                "downloads": _parse_int(values.get("downloads"), 0),
                "engagementRate": str(values.get("avg_engagement_time_sec") or "0"),
                "is_active": str(values.get("is_active") or ""),
                "sessionSource": str(values.get("session_source") or ""),
                "browser": str(values.get("browser") or ""),
                "operatingSystemWithVersion": str(values.get("os") or ""),
                "emergency_id": _parse_int(values.get("emergency_id"), 0),
            }
        )
    return output


def _build_views_by_date(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    buckets = Counter()
    for row in rows:
        buckets[str(row.get("date") or "unknown")] += _row_views(row)
    return [{"label": bucket, "views": count} for bucket, count in sorted(buckets.items())[:30]]


def _build_engagement_performance(rows: list[dict]) -> list[dict]:
    page_counter = Counter()
    for row in rows:
        page = row.get("fullPageUrl")
        if page:
            page_counter[page] += _row_views(row)
    result = []
    for page, views in page_counter.most_common(10):
        page_rows = [r for r in rows if r.get("fullPageUrl") == page]
        weighted_views = sum(_row_views(r) for r in page_rows)
        engagement_total = sum(_parse_engagement_rate(r.get("engagementRate")) * _row_views(r) for r in page_rows)
        avg_engagement = engagement_total / max(weighted_views, 1)
        downloads = sum(_parse_int(r.get("downloads"), 0) for r in page_rows)
        result.append(
            {
                "page": page,
                "views": views,
                "downloads": downloads,
                "avg_engagement_rate": round(avg_engagement, 4),
            }
        )
    return result


def _build_metadata_lookup(rows: list[dict]) -> list[dict]:
    event_rows: dict[str, list[dict]] = {}
    for row in rows:
        event_id = str(row.get("emergency_id") or "")
        if not event_id or event_id == "0":
            continue
        event_rows.setdefault(event_id, []).append(row)

    payload = []
    for event_id, values in sorted(
        event_rows.items(),
        key=lambda item: sum(_row_views(r) for r in item[1]),
        reverse=True,
    )[:10]:
        total_views = sum(_row_views(v) for v in values)
        source_counter = Counter()
        for value in values:
            source = value.get("sessionSource")
            if source:
                source_counter[source] += _row_views(value)
        payload.append(
            {
                "event_id": event_id,
                "views": total_views,
                "countries": sorted({v.get("country") for v in values if v.get("country")})[:5],
                "top_sources": source_counter.most_common(3),
            }
        )
    return payload


class AnalyticsView(APIView):
    authentication_classes = (TokenAuthentication,)
    permission_classes = (IsAuthenticated, DenyGuestUserPermission)

    def get(self, request, *args, **kwargs):
        access = get_analytics_access(request.user)
        role_profile = infer_role_profile(access)

        scope = {
            "global": access["global_access"],
            "live": access["live_access"],
            "regions": access["region_codes"],
        }

        dataset_path = _find_dataset_path()
        country_region = _country_region_map()
        iso3_region_map = _country_iso3_region_map()
        iso_region_map = _country_iso_region_map()
        iso_name_map = _country_iso_name_map()
        rows = _load_xlsx_rows(dataset_path)
        event_ids = {_parse_int(r.get("emergency_id"), 0) for r in rows if _parse_int(r.get("emergency_id"), 0) > 0}
        event_scope_map = _build_event_scope_map(event_ids)
        fallback_scope_by_event_id: dict[int, dict[str, set[str]]] = {}

        filtered_rows: list[dict] = []
        for row in rows:
            country_iso = (row.get("country") or "").strip().upper()
            row["country"] = iso_name_map.get(country_iso, country_iso)
            event_id = _parse_int(row.get("emergency_id"), 0)
            event_scope = event_scope_map.get(event_id, {"regions": set(), "countries": set()})
            if event_id > 0 and not event_scope["regions"]:
                if event_id not in fallback_scope_by_event_id:
                    inferred_regions = _infer_regions_from_emergency_name(
                        str(row.get("emergency_name") or ""),
                        country_region,
                        iso3_region_map,
                    )
                    fallback_scope_by_event_id[event_id] = {"regions": inferred_regions, "countries": set()}
                event_scope = fallback_scope_by_event_id[event_id]

            if not scope["global"]:
                if scope["regions"]:
                    if not event_scope["regions"].intersection(scope["regions"]):
                        continue
                elif scope["live"]:
                    if not _is_active_emergency(row):
                        continue
                else:
                    continue

            if scope["live"] and not scope["global"] and not _is_active_emergency(row):
                continue

            filtered_rows.append(row)

        available_modules = get_available_modules(role_profile["role"])
        total_visits = sum(_row_views(r) for r in filtered_rows)
        top_pages_counter = Counter()
        top_countries_counter = Counter()
        for row in filtered_rows:
            views = _row_views(row)
            page = row.get("fullPageUrl")
            country = row.get("country")
            if page:
                top_pages_counter[page] += views
            if country:
                top_countries_counter[country] += views
        top_pages = top_pages_counter.most_common(10)
        top_countries = top_countries_counter.most_common(10)
        emergency_rows = [r for r in filtered_rows if _is_active_emergency(r)]
        module_data: dict[str, object] = {}

        if MODULE_OVERVIEW in available_modules:
            module_data[MODULE_OVERVIEW] = {
                "total_visits": total_visits,
                "total_emergency_views": len(emergency_rows),
                "unique_countries": len({r.get("country") for r in filtered_rows if r.get("country")}),
            }
        if MODULE_VIEWS_BY_DATE in available_modules:
            module_data[MODULE_VIEWS_BY_DATE] = _build_views_by_date(filtered_rows)
        if MODULE_TOP_PAGES in available_modules:
            module_data[MODULE_TOP_PAGES] = top_pages
        if MODULE_TOP_COUNTRIES in available_modules:
            module_data[MODULE_TOP_COUNTRIES] = top_countries
        if MODULE_MAP_HEATMAP in available_modules:
            module_data[MODULE_MAP_HEATMAP] = {
                "country_views": top_countries,
            }
        if MODULE_ENGAGEMENT_PERFORMANCE in available_modules:
            module_data[MODULE_ENGAGEMENT_PERFORMANCE] = _build_engagement_performance(filtered_rows)
        if MODULE_AUDIENCE_INSIGHTS in available_modules:
            module_data[MODULE_AUDIENCE_INSIGHTS] = {
                "by_source": Counter(r.get("sessionSource") for r in filtered_rows if r.get("sessionSource")).most_common(8),
                "by_browser": Counter(r.get("browser") for r in filtered_rows if r.get("browser")).most_common(8),
                "by_os": Counter(
                    r.get("operatingSystemWithVersion")
                    for r in filtered_rows
                    if r.get("operatingSystemWithVersion")
                ).most_common(8),
            }
        if MODULE_LIVE_MONITORING in available_modules:
            module_data[MODULE_LIVE_MONITORING] = {
                "last_window_views": len(emergency_rows),
                "top_active_emergencies": _build_metadata_lookup(emergency_rows)[:5],
            }
        if MODULE_LIVE_SPIKES in available_modules:
            event_counts = Counter()
            for row in filtered_rows:
                url = row.get("fullPageUrl") or ""
                match = EVENT_URL_PATTERN.search(url)
                if match:
                    event_counts[match.group(1)] += 1
            module_data[MODULE_LIVE_SPIKES] = [
                {"event_id": event_id, "views": views, "is_spike": views >= 2}
                for event_id, views in event_counts.most_common(10)
            ]
        if MODULE_PLATFORM_ADOPTION in available_modules:
            module_data[MODULE_PLATFORM_ADOPTION] = {
                "active_countries": len({r.get("country") for r in filtered_rows if r.get("country")}),
                "countries_publishing_pct": round(
                    (
                        len({r.get("country") for r in filtered_rows if r.get("country")})
                        / max(len(iso_region_map), 1)
                    ) * 100,
                    2,
                ),
                "views_buckets": _build_views_by_date(filtered_rows),
            }
        if MODULE_ENGAGEMENT_COMPARISON in available_modules:
            module_data[MODULE_ENGAGEMENT_COMPARISON] = {
                "by_country": top_countries[:5],
                "by_region": Counter(country_region.get((r.get("country") or "").strip().lower()) for r in filtered_rows).most_common(5),
            }
        if MODULE_METADATA_LOOKUP in available_modules:
            module_data[MODULE_METADATA_LOOKUP] = _build_metadata_lookup(filtered_rows)

        return Response({
            "contract_version": 1,
            "role_profile": {
                **role_profile,
                "content_scope": {"global": scope["global"], "regions": scope["regions"], "live": scope["live"]},
                "audience_scope": {"global": True},
            },
            "scope": scope,
            "available_modules": available_modules,
            "module_data": module_data,
            "summary": {
                "total_visits": total_visits,
                "top_pages": top_pages,
                "top_countries": top_countries,
            },
        })
