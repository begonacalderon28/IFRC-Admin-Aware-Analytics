import { type ReactNode } from 'react';
import { isDefined } from '@togglecorp/fujs';

import Page from '#components/Page';
import usePermissions from '#hooks/domain/usePermissions';
import { useExternalRequest } from '#utils/restRequest';

type RankedItem = [string, number];

type AnalyticsResponse = {
    contract_version?: number;
    role_profile?: {
        role: string;
        realtime_enabled: boolean;
        historical_depth: string;
        content_scope?: {
            global?: boolean;
            regions?: string[];
            live?: boolean;
        };
        audience_scope?: {
            global?: boolean;
        };
    };
    scope: {
        global: boolean;
        live: boolean;
        regions: string[];
    };
    available_modules?: string[];
    module_data?: Record<string, unknown>;
    summary: {
        total_visits: number;
        top_pages: RankedItem[];
        top_countries: RankedItem[];
    };
};

function KeyValueList({ items }: { items: RankedItem[] | undefined }) {
    if (!items || items.length === 0) {
        return <p>No data</p>;
    }

    return (
        <ol>
            {items.map(([label, value]) => (
                <li key={label}>
                    {label}
                    {': '}
                    {value}
                </li>
            ))}
        </ol>
    );
}

function ModuleSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section>
            <h3>{title}</h3>
            {children}
        </section>
    );
}

function renderModule(moduleKey: string, data: unknown) {
    if (moduleKey === 'overview') {
        const overview = data as {
            total_visits?: number;
            total_emergency_views?: number;
            unique_countries?: number;
        };
        return (
            <ModuleSection title="Overview">
                <p>
                    <strong>Total visits:</strong>
                    {' '}
                    {overview?.total_visits ?? 0}
                </p>
                <p>
                    <strong>Total emergency views:</strong>
                    {' '}
                    {overview?.total_emergency_views ?? 0}
                </p>
                <p>
                    <strong>Unique countries:</strong>
                    {' '}
                    {overview?.unique_countries ?? 0}
                </p>
            </ModuleSection>
        );
    }

    if (moduleKey === 'views_by_date') {
        const rows = (data as { label: string; views: number }[]) ?? [];
        return (
            <ModuleSection title="Views by date">
                <ol>
                    {rows.map((row) => (
                        <li key={row.label}>
                            {row.label}
                            {': '}
                            {row.views}
                        </li>
                    ))}
                </ol>
            </ModuleSection>
        );
    }

    if (moduleKey === 'top_pages') {
        return (
            <ModuleSection title="Top pages">
                <KeyValueList items={data as RankedItem[]} />
            </ModuleSection>
        );
    }

    if (moduleKey === 'top_countries') {
        return (
            <ModuleSection title="Top countries">
                <KeyValueList items={data as RankedItem[]} />
            </ModuleSection>
        );
    }

    if (moduleKey === 'map_heatmap') {
        const payload = data as { country_views?: RankedItem[] };
        return (
            <ModuleSection title="Map">
                <p>Heatmap preview (country-level):</p>
                <KeyValueList items={payload?.country_views} />
            </ModuleSection>
        );
    }

    if (moduleKey === 'engagement_performance') {
        const rows = (data as {
            page: string;
            views: number;
            downloads: number;
            avg_engagement_rate: number;
        }[]) ?? [];
        return (
            <ModuleSection title="Engagement performance">
                <ol>
                    {rows.map((row) => (
                        <li key={row.page}>
                            {row.page}
                            {': '}
                            {row.views}
                            {' views | '}
                            {row.downloads}
                            {' downloads | engagement '}
                            {row.avg_engagement_rate}
                        </li>
                    ))}
                </ol>
            </ModuleSection>
        );
    }

    if (moduleKey === 'audience_insights') {
        const payload = data as {
            by_source?: RankedItem[];
            by_browser?: RankedItem[];
            by_os?: RankedItem[];
        };
        return (
            <ModuleSection title="Audience insights">
                <p><strong>By source</strong></p>
                <KeyValueList items={payload?.by_source} />
                <p><strong>By browser</strong></p>
                <KeyValueList items={payload?.by_browser} />
                <p><strong>By OS</strong></p>
                <KeyValueList items={payload?.by_os} />
            </ModuleSection>
        );
    }

    if (moduleKey === 'live_monitoring') {
        const payload = data as {
            last_window_views?: number;
            top_active_emergencies?: { event_id: string; views: number }[];
        };
        return (
            <ModuleSection title="Live monitoring">
                <p>
                    <strong>Recent emergency views:</strong>
                    {' '}
                    {payload?.last_window_views ?? 0}
                </p>
                <ol>
                    {payload?.top_active_emergencies?.map((item) => (
                        <li key={item.event_id}>
                            Event
                            {' '}
                            {item.event_id}
                            {': '}
                            {item.views}
                        </li>
                    ))}
                </ol>
            </ModuleSection>
        );
    }

    if (moduleKey === 'live_spikes') {
        const rows = (data as { event_id: string; views: number; is_spike: boolean }[]) ?? [];
        return (
            <ModuleSection title="Live spikes">
                <ol>
                    {rows.map((row) => (
                        <li key={row.event_id}>
                            Event
                            {' '}
                            {row.event_id}
                            {': '}
                            {row.views}
                            {' views'}
                            {row.is_spike ? ' (spike)' : ''}
                        </li>
                    ))}
                </ol>
            </ModuleSection>
        );
    }

    if (moduleKey === 'platform_adoption') {
        const payload = data as {
            active_countries?: number;
            countries_publishing_pct?: number;
        };
        return (
            <ModuleSection title="Platform adoption">
                <p>
                    <strong>Active countries:</strong>
                    {' '}
                    {payload?.active_countries ?? 0}
                </p>
                <p>
                    <strong>Countries publishing (%):</strong>
                    {' '}
                    {payload?.countries_publishing_pct ?? 0}
                </p>
            </ModuleSection>
        );
    }

    if (moduleKey === 'engagement_comparison') {
        const payload = data as {
            by_country?: RankedItem[];
            by_region?: RankedItem[];
        };
        return (
            <ModuleSection title="Engagement comparison">
                <p><strong>By country</strong></p>
                <KeyValueList items={payload?.by_country} />
                <p><strong>By region</strong></p>
                <KeyValueList items={payload?.by_region} />
            </ModuleSection>
        );
    }

    if (moduleKey === 'metadata_lookup') {
        const rows = (data as {
            event_id: string;
            views: number;
            countries: string[];
        }[]) ?? [];
        return (
            <ModuleSection title="Metadata lookup">
                <ol>
                    {rows.map((row) => (
                        <li key={row.event_id}>
                            Event
                            {' '}
                            {row.event_id}
                            {': '}
                            {row.views}
                            {' views | countries: '}
                            {row.countries.join(', ')}
                        </li>
                    ))}
                </ol>
            </ModuleSection>
        );
    }

    return (
        <ModuleSection title={moduleKey}>
            <p>Module renderer not implemented yet.</p>
        </ModuleSection>
    );
}

/** @knipignore */
// eslint-disable-next-line import/prefer-default-export
export function Component() {
    const { canViewAnalytics } = usePermissions();
    const {
        pending,
        error,
        response,
    } = useExternalRequest<AnalyticsResponse>({
        skip: !canViewAnalytics,
        url: '/api/v2/analytics/',
        preserveResponse: true,
    });

    return (
        <Page
            title="Analytics"
            heading="Analytics"
        >
            {!canViewAnalytics && (
                <p>You do not have analytics access.</p>
            )}
            {canViewAnalytics && (
                <div>
                    {pending && <p>Loading analytics...</p>}
                    {error && (
                        <p>
                            Failed to load analytics.
                            {' '}
                            {error.value.messageForNotification}
                        </p>
                    )}
                    {!pending && !error && isDefined(response) && (
                        <>
                            <p>
                                <strong>Global access:</strong>
                                {' '}
                                {response.scope.global ? 'Yes' : 'No'}
                            </p>
                            <p>
                                <strong>Live emergency access:</strong>
                                {' '}
                                {response.scope.live ? 'Yes' : 'No'}
                            </p>
                            <p>
                                <strong>Regional access:</strong>
                                {' '}
                                {response.scope.regions.length > 0
                                    ? response.scope.regions.join(', ')
                                    : 'None'}
                            </p>
                            <p>
                                <strong>Role:</strong>
                                {' '}
                                {response.role_profile?.role ?? 'unknown'}
                            </p>
                            <p>
                                <strong>Realtime:</strong>
                                {' '}
                                {response.role_profile?.realtime_enabled ? 'Yes' : 'No'}
                            </p>
                            <p>
                                <strong>Historical depth:</strong>
                                {' '}
                                {response.role_profile?.historical_depth ?? 'n/a'}
                            </p>
                            {(response.available_modules ?? []).map((moduleKey) => (
                                <div key={moduleKey}>
                                    {renderModule(
                                        moduleKey,
                                        response.module_data?.[moduleKey],
                                    )}
                                </div>
                            ))}
                            {(!response.available_modules || response.available_modules.length === 0) && (
                                <>
                                    <p>No module access assigned for this user.</p>
                                    <p>
                                        <strong>Total visits (fallback):</strong>
                                        {' '}
                                        {response.summary.total_visits}
                                    </p>
                                    <h3>Top pages</h3>
                                    <KeyValueList items={response.summary.top_pages} />
                                    <h3>Top countries</h3>
                                    <KeyValueList items={response.summary.top_countries} />
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </Page>
    );
}

Component.displayName = 'Analytics';
