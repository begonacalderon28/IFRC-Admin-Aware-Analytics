import csv
from collections import Counter
from pathlib import Path

from rest_framework.authentication import TokenAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Country
from main.permissions import DenyGuestUserPermission


def _find_dataset_path() -> Path:
    # Look in repo root and in the API project root
    base_dir = Path(__file__).resolve().parents[1]
    candidates = [
        base_dir / "go_ga_data_sample_30_v2.csv",
        base_dir.parent / "go_ga_data_sample_30_v2.csv",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError("go_ga_data_sample_30_v2.csv not found")


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


def _is_emergency_url(url: str | None) -> bool:
    if not url:
        return False
    return "/emergencies/" in url or "/alerts/" in url


class AnalyticsView(APIView):
    authentication_classes = (TokenAuthentication,)
    permission_classes = (IsAuthenticated, DenyGuestUserPermission)

    def get(self, request, *args, **kwargs):
        user = request.user

        perms = user.get_all_permissions()
        region_codes = [
            p.replace("api.analytics_view_region_", "")
            for p in perms
            if p.startswith("api.analytics_view_region_")
        ]

        scope = {
            "global": user.has_perm("api.analytics_view_global"),
            "live": user.has_perm("api.analytics_view_live"),
            "regions": region_codes,
        }

        dataset_path = _find_dataset_path()
        country_region = _country_region_map()

        filtered_rows: list[dict] = []
        with dataset_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                country = (row.get("country") or "").strip().lower()
                region_code = country_region.get(country)

                if not scope["global"]:
                    if scope["regions"]:
                        if region_code not in scope["regions"]:
                            continue
                    elif scope["live"]:
                        if not _is_emergency_url(row.get("fullPageUrl")):
                            continue
                    else:
                        continue

                if scope["live"] and not scope["global"]:
                    if not _is_emergency_url(row.get("fullPageUrl")):
                        continue

                filtered_rows.append(row)

        total_visits = len(filtered_rows)
        top_pages = Counter(r.get("fullPageUrl") for r in filtered_rows).most_common(10)
        top_countries = Counter(r.get("country") for r in filtered_rows).most_common(10)

        return Response({
            "scope": scope,
            "summary": {
                "total_visits": total_visits,
                "top_pages": top_pages,
                "top_countries": top_countries,
            },
        })
