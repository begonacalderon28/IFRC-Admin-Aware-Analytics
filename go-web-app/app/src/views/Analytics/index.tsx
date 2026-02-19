import {
    type CSSProperties,
    type ReactNode,
    useRef,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { isDefined } from '@togglecorp/fujs';
import Page from '#components/Page';
import {
    ComposableMap,
    Geographies,
    Geography,
    ZoomableGroup,
} from 'react-simple-maps';
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
    filters_applied?: {
        start_date?: string | null;
        end_date?: string | null;
    };
    available_modules?: string[];
    module_data?: Record<string, unknown>;
    summary: {
        total_visits: number;
        top_pages: RankedItem[];
        top_countries: RankedItem[];
    };
};

type DateViewsItem = {
    label: string;
    views: number;
};

type ViewsByDatePayload = {
    series?: DateViewsItem[];
    available_labels?: string[];
};

type MapHeatmapPayload = {
    country_views?: RankedItem[];
    country_views_all?: RankedItem[];
    country_views_iso3?: {
        iso3: string;
        views: number;
    }[];
    can_city_drilldown?: boolean;
    city_views_by_country?: Record<string, RankedItem[]>;
};

type EngagementComparisonPayload = {
    allowed_modes?: string[];
    mode?: string;
    options?: string[];
    available_months?: string[];
    selected_left?: string;
    selected_right?: string;
    period_a_start?: string;
    period_a_end?: string;
    period_b_start?: string;
    period_b_end?: string;
    results?: {
        period_a?: {
            left?: { total_page_views?: number; avg_engagement_time_sec?: number };
            right?: { total_page_views?: number; avg_engagement_time_sec?: number };
        };
        period_b?: {
            left?: { total_page_views?: number; avg_engagement_time_sec?: number };
            right?: { total_page_views?: number; avg_engagement_time_sec?: number };
        };
    };
};

function normalizeCountryLabel(value: string) {
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (
        normalized === 'united states of america'
        || normalized === 'usa'
        || normalized === 'us'
    ) {
        return 'united states';
    }
    return normalized;
}

function getGeoApproxCenter(geo: { geometry?: { coordinates?: unknown } }) {
    const coordinates: [number, number][] = [];
    const walk = (node: unknown) => {
        if (!Array.isArray(node)) {
            return;
        }
        if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
            coordinates.push([node[0], node[1]]);
            return;
        }
        node.forEach((child) => walk(child));
    };
    walk(geo.geometry?.coordinates);
    if (coordinates.length === 0) {
        return undefined;
    }
    const [sumLon, sumLat] = coordinates.reduce<[number, number]>(
        (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
        [0, 0],
    );
    return [sumLon / coordinates.length, sumLat / coordinates.length] as [number, number];
}

function getRegionLabel(regionCode: string) {
    const labelMap: Record<string, string> = {
        africa: 'Africa',
        americas: 'Americas',
        'asia-pacific': 'Asia-Pacific',
        europe: 'Europe',
        'middle-east-north-africa': 'Middle East & North Africa',
    };
    return labelMap[regionCode] ?? regionCode;
}

function getAnalyticsPageTitle(response: AnalyticsResponse | undefined) {
    const role = response?.role_profile?.role;
    if (role === 'ops_im') {
        return 'Analytics - Information Management Officer';
    }
    if (role === 'regional_im') {
        const regions = response?.scope?.regions ?? [];
        const regionTitle = regions.map(getRegionLabel).join(', ');
        return regionTitle
            ? `Analytics - ${regionTitle} Regional Admin`
            : 'Analytics - Regional Admin';
    }
    if (role === 'global_im') {
        return 'Analytics - Global Admin';
    }
    if (role === 'country_im') {
        return 'Analytics - Country Admin';
    }
    return 'Analytics';
}

function formatMonthLabel(monthKey: string) {
    const [year, month] = monthKey.split('-');
    const monthNumber = Number(month);
    const yearNumber = Number(year);
    if (!Number.isFinite(monthNumber) || !Number.isFinite(yearNumber)) {
        return monthKey;
    }
    const date = new Date(yearNumber, monthNumber - 1, 1);
    return date.toLocaleString('en', { month: 'short', year: '2-digit' });
}

function formatDateLabel(labelKey: string) {
    if (labelKey.length >= 10) {
        const [yearText, monthText, dayText] = labelKey.split('-');
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        if (
            Number.isFinite(year)
            && Number.isFinite(month)
            && Number.isFinite(day)
            && month >= 1
            && month <= 12
            && day >= 1
            && day <= 31
        ) {
            const localDate = new Date(year, month - 1, day);
            return localDate.toLocaleString('en', { day: '2-digit', month: 'short' });
        }
    }
    return formatMonthLabel(labelKey);
}

function getDateLabelParts(labelKey: string) {
    if (labelKey.length >= 10) {
        const [yearText, monthText, dayText] = labelKey.split('-');
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        if (
            Number.isFinite(year)
            && Number.isFinite(month)
            && Number.isFinite(day)
            && month >= 1
            && month <= 12
            && day >= 1
            && day <= 31
        ) {
            const localDate = new Date(year, month - 1, day);
            return {
                primary: localDate.toLocaleString('en', { month: 'short' }),
                secondary: String(day).padStart(2, '0'),
            };
        }
    }
    const [month, year] = formatMonthLabel(labelKey).split(' ');
    return { primary: month ?? labelKey, secondary: year ?? '' };
}

function monthStartDate(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    return `${year}-${String(month).padStart(2, '0')}-01`;
}

function monthEndDate(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    const end = new Date(year, month, 0);
    return end.toISOString().slice(0, 10);
}

function ViewsByMonthColumnChart({ data }: { data: DateViewsItem[] }) {
    if (data.length === 0) {
        return <p>No data</p>;
    }

    const maxValue = Math.max(...data.map((d) => d.views), 1);
    const chartHeight = 360;
    const [hoveredItem, setHoveredItem] = useState<DateViewsItem | undefined>();
    const [hoveredPosition, setHoveredPosition] = useState<{ x: number; y: number } | undefined>();
    const chartRef = useRef<HTMLDivElement>(null);

    return (
        <div
            ref={chartRef}
            style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '0.25rem',
                minHeight: `${chartHeight}px`,
                padding: '0.5rem 0',
                overflowX: 'auto',
                overflowY: 'visible',
                borderBottom: '1px solid #ddd',
                position: 'relative',
            }}
        >
            {hoveredItem && hoveredPosition && (
                <div
                    style={{
                        position: 'absolute',
                        top: `${Math.max(4, hoveredPosition.y - 28)}px`,
                        left: `${hoveredPosition.x}px`,
                        transform: 'translateX(-50%)',
                        backgroundColor: '#0f172a',
                        color: '#fff',
                        padding: '0.45rem 0.55rem',
                        borderRadius: '8px',
                        fontSize: '0.75rem',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        boxShadow: '0 8px 20px rgba(2, 6, 23, 0.25)',
                        border: '1px solid rgba(148, 163, 184, 0.35)',
                        zIndex: 10,
                    }}
                >
                    {`${formatDateLabel(hoveredItem.label)}: ${hoveredItem.views.toLocaleString('en-US')} views`}
                </div>
            )}
            {data.map((item) => {
                const isHovered = hoveredItem?.label === item.label;
                const barHeight = Math.max(2, (item.views / maxValue) * chartHeight);
                return (
                <div
                    key={item.label}
                    style={{
                        minWidth: '2rem',
                        textAlign: 'center',
                    }}
                    onMouseEnter={(e) => {
                        const chartRect = chartRef.current?.getBoundingClientRect();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredItem(item);
                        if (chartRect) {
                            setHoveredPosition({
                                x: rect.left + rect.width / 2 - chartRect.left + (chartRef.current?.scrollLeft ?? 0),
                                y: Math.max(8, chartHeight - barHeight - 10),
                            });
                        }
                    }}
                    onMouseLeave={() => {
                        setHoveredItem(undefined);
                        setHoveredPosition(undefined);
                    }}
                >
                    <div
                        style={{
                            height: `${barHeight}px`,
                            backgroundColor: isHovered ? '#3b82f6' : '#93c5fd',
                            borderRadius: '3px 3px 0 0',
                            cursor: 'pointer',
                        }}
                    />
                    <div style={{ fontSize: '0.65rem', marginTop: '0.25rem' }}>
                        {(() => {
                            const parts = getDateLabelParts(item.label);
                            return (
                                <>
                                    <span style={{ display: 'block' }}>{parts.primary}</span>
                                    <span style={{ display: 'block' }}>{parts.secondary}</span>
                                </>
                            );
                        })()}
                    </div>
                </div>
                );
            })}
        </div>
    );
}

function ViewsByDateModule(props: {
    payload: ViewsByDatePayload | undefined;
    selectedStartDate?: string | null;
    selectedEndDate?: string | null;
    onApplyRange: (startDate: string, endDate: string) => void;
    onResetRange: () => void;
}) {
    const {
        payload,
        selectedStartDate,
        selectedEndDate,
        onApplyRange,
        onResetRange,
    } = props;

    const series = payload?.series ?? [];
    const availableLabels = payload?.available_labels ?? [];
    const [startIndex, setStartIndex] = useState<number>(0);
    const [endIndex, setEndIndex] = useState<number>(Math.max(availableLabels.length - 1, 0));
    const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | undefined>();
    const sliderTrackRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (availableLabels.length === 0) {
            setStartIndex(0);
            setEndIndex(0);
            return;
        }

        const defaultStart = 0;
        const defaultEnd = availableLabels.length - 1;
        const startFromFilter = selectedStartDate ? selectedStartDate.slice(0, 7) : undefined;
        const endFromFilter = selectedEndDate ? selectedEndDate.slice(0, 7) : undefined;
        const startIdx = startFromFilter ? availableLabels.indexOf(startFromFilter) : -1;
        const endIdx = endFromFilter ? availableLabels.indexOf(endFromFilter) : -1;

        setStartIndex(startIdx >= 0 ? startIdx : defaultStart);
        setEndIndex(endIdx >= 0 ? endIdx : defaultEnd);
    }, [availableLabels, selectedStartDate, selectedEndDate]);

    const safeStart = Math.min(startIndex, endIndex);
    const safeEnd = Math.max(startIndex, endIndex);
    const startLabel = availableLabels[safeStart];
    const endLabel = availableLabels[safeEnd];
    const rangeStartPct = availableLabels.length > 1 ? (safeStart / (availableLabels.length - 1)) * 100 : 0;
    const rangeEndPct = availableLabels.length > 1 ? (safeEnd / (availableLabels.length - 1)) * 100 : 100;

    useEffect(() => {
        if (!draggingHandle) {
            return undefined;
        }

        const updateFromClientX = (clientX: number) => {
            const rect = sliderTrackRef.current?.getBoundingClientRect();
            if (!rect || availableLabels.length <= 1) {
                return;
            }
            const clampedX = Math.min(Math.max(clientX, rect.left), rect.right);
            const ratio = (clampedX - rect.left) / rect.width;
            const nextIndex = Math.round(ratio * (availableLabels.length - 1));

            if (draggingHandle === 'start') {
                setStartIndex(Math.min(nextIndex, endIndex));
            } else {
                setEndIndex(Math.max(nextIndex, startIndex));
            }
        };

        const onMouseMove = (event: MouseEvent) => updateFromClientX(event.clientX);
        const onMouseUp = () => setDraggingHandle(undefined);

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }, [draggingHandle, availableLabels.length, startIndex, endIndex]);

    return (
        <section
            style={{
                background: '#ffffff',
                border: '1px solid #d6e6f5',
                borderLeft: '6px solid #94b7d8',
                borderRadius: '12px',
                padding: '1rem',
                marginBottom: '1rem',
            }}
        >
            <h2
                style={{
                    fontSize: '1.55rem',
                    fontWeight: 800,
                    margin: '0 0 0.75rem 0',
                    color: '#1f2937',
                    letterSpacing: '0.01em',
                }}
            >
                Views by Date
            </h2>
            {availableLabels.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                        Range:
                        {' '}
                        <strong>{formatMonthLabel(startLabel)}</strong>
                        {' - '}
                        <strong>{formatMonthLabel(endLabel)}</strong>
                    </div>
                    <div style={{ maxWidth: '42rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.45rem' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' }}>
                                Start: {formatMonthLabel(startLabel)}
                            </span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' }}>
                                End: {formatMonthLabel(endLabel)}
                            </span>
                        </div>
                        <div
                            style={{
                                position: 'relative',
                                height: '2rem',
                                marginBottom: '0.25rem',
                            }}
                            ref={sliderTrackRef}
                        >
                            <div
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    right: 0,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    height: '0.28rem',
                                    background: '#e5e7eb',
                                    borderRadius: '9999px',
                                    pointerEvents: 'none',
                                }}
                            />
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${rangeStartPct}%`,
                                    width: `${Math.max(rangeEndPct - rangeStartPct, 0)}%`,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    height: '0.32rem',
                                    background: '#93c5fd',
                                    borderRadius: '9999px',
                                    pointerEvents: 'none',
                                }}
                            />
                            <button
                                type="button"
                                aria-label="Adjust start of range"
                                onMouseDown={() => setDraggingHandle('start')}
                                style={{
                                    position: 'absolute',
                                    left: `${rangeStartPct}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '1rem',
                                    height: '1rem',
                                    borderRadius: '9999px',
                                    border: '2px solid #60a5fa',
                                    backgroundColor: '#fff',
                                    cursor: 'ew-resize',
                                    zIndex: 6,
                                    padding: 0,
                                }}
                            />
                            <button
                                type="button"
                                aria-label="Adjust end of range"
                                onMouseDown={() => setDraggingHandle('end')}
                                style={{
                                    position: 'absolute',
                                    left: `${rangeEndPct}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: '1rem',
                                    height: '1rem',
                                    borderRadius: '9999px',
                                    border: '2px solid #60a5fa',
                                    backgroundColor: '#fff',
                                    cursor: 'ew-resize',
                                    zIndex: 6,
                                    padding: 0,
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#4b5563' }}>
                            <span>{formatMonthLabel(availableLabels[0])}</span>
                            <span>{formatMonthLabel(availableLabels[availableLabels.length - 1])}</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button
                            type="button"
                            onClick={() => {
                                if (!startLabel || !endLabel) {
                                    return;
                                }
                                onApplyRange(monthStartDate(startLabel), monthEndDate(endLabel));
                            }}
                            style={{
                                backgroundColor: '#334155',
                                color: '#fff',
                                border: '1px solid #1f2937',
                                borderRadius: '6px',
                                padding: '0.35rem 0.7rem',
                                fontWeight: 600,
                            }}
                        >
                            Apply range
                        </button>
                        <button
                            type="button"
                            onClick={onResetRange}
                            style={{
                                backgroundColor: '#fff',
                                color: '#1f2937',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                padding: '0.35rem 0.7rem',
                                fontWeight: 600,
                            }}
                        >
                            Reset
                        </button>
                    </div>
                </div>
            )}
            <ViewsByMonthColumnChart data={series} />
        </section>
    );
}

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

type EngagementRow = {
    event_id: string;
    emergency_name: string;
    page_url?: string;
    total_page_views: number;
    views_last_month?: number;
    documents_download: number;
    avg_engagement_time_sec: number;
};

function EngagementPerformanceTable({
    rows,
    showLastMonthColumn,
}: {
    rows: EngagementRow[];
    showLastMonthColumn: boolean;
}) {
    const [sortKey, setSortKey] = useState<keyof EngagementRow>('total_page_views');
    const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
    const [searchText, setSearchText] = useState('');

    const sortedRows = useMemo(() => {
        const sorted = [...rows].sort((a, b) => {
            const aValue = a[sortKey];
            const bValue = b[sortKey];
            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
            }
            if (aValue === undefined || bValue === undefined) {
                const aNum = typeof aValue === 'number' ? aValue : 0;
                const bNum = typeof bValue === 'number' ? bValue : 0;
                return sortDirection === 'desc' ? bNum - aNum : aNum - bNum;
            }
            const compareResult = String(aValue).localeCompare(String(bValue));
            return sortDirection === 'desc' ? -compareResult : compareResult;
        });
        return sorted;
    }, [rows, sortKey, sortDirection]);
    const normalizedSearch = searchText.trim().toLowerCase();
    const visibleRows = useMemo(
        () => sortedRows.filter((row) => (
            row.event_id.toLowerCase().includes(normalizedSearch)
            || row.emergency_name.toLowerCase().includes(normalizedSearch)
        )),
        [sortedRows, normalizedSearch],
    );

    const onSort = (nextSortKey: keyof EngagementRow) => {
        if (sortKey === nextSortKey) {
            setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
            return;
        }
        setSortKey(nextSortKey);
        setSortDirection('desc');
    };

    const sortArrow = (key: keyof EngagementRow) => (sortKey === key ? (sortDirection === 'desc' ? ' ↓' : ' ↑') : '');

    if (rows.length === 0) {
        return <p>No data</p>;
    }

    return (
        <>
            <div style={{ marginBottom: '0.55rem' }}>
                <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.currentTarget.value)}
                    placeholder="Search emergency ID or name"
                    style={{
                        width: '100%',
                        maxWidth: '24rem',
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '0.45rem 0.65rem',
                        fontSize: '0.88rem',
                        backgroundColor: '#fff',
                    }}
                />
            </div>
            <div
                style={{
                    border: '1px solid #dbe7f3',
                    borderRadius: '8px',
                    backgroundColor: '#fff',
                }}
            >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', tableLayout: 'fixed' }}>
                <colgroup>
                    <col style={{ width: '12%' }} />
                    <col style={{ width: showLastMonthColumn ? '30%' : '36%' }} />
                    <col style={{ width: showLastMonthColumn ? '14%' : '18%' }} />
                    {showLastMonthColumn && <col style={{ width: '14%' }} />}
                    <col style={{ width: showLastMonthColumn ? '14%' : '18%' }} />
                    <col style={{ width: showLastMonthColumn ? '16%' : '16%' }} />
                </colgroup>
                <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #dbe7f3' }}>
                        <th style={{ backgroundColor: '#f8fbff', padding: '0.4rem 0.35rem' }}><button type="button" onClick={() => onSort('event_id')} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>Emergency ID{sortArrow('event_id')}</button></th>
                        <th style={{ backgroundColor: '#f8fbff', padding: '0.4rem 0.35rem' }}><button type="button" onClick={() => onSort('emergency_name')} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>Emergency{sortArrow('emergency_name')}</button></th>
                        <th style={{ backgroundColor: '#f8fbff', padding: '0.4rem 0.35rem' }}><button type="button" onClick={() => onSort('total_page_views')} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>Total Page Views{sortArrow('total_page_views')}</button></th>
                        {showLastMonthColumn && (
                            <th style={{ backgroundColor: '#f8fbff', padding: '0.4rem 0.35rem' }}><button type="button" onClick={() => onSort('views_last_month')} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>Views (Last Month){sortArrow('views_last_month')}</button></th>
                        )}
                        <th style={{ backgroundColor: '#f8fbff', padding: '0.4rem 0.35rem' }}><button type="button" onClick={() => onSort('documents_download')} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>Documents Download{sortArrow('documents_download')}</button></th>
                        <th style={{ backgroundColor: '#f8fbff', padding: '0.4rem 0.35rem' }}><button type="button" onClick={() => onSort('avg_engagement_time_sec')} style={{ all: 'unset', cursor: 'pointer', fontWeight: 700 }}>Avg Engagement (sec){sortArrow('avg_engagement_time_sec')}</button></th>
                    </tr>
                </thead>
            </table>
            <div style={{ maxHeight: '18rem', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem', tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: '12%' }} />
                        <col style={{ width: showLastMonthColumn ? '30%' : '36%' }} />
                        <col style={{ width: showLastMonthColumn ? '14%' : '18%' }} />
                        {showLastMonthColumn && <col style={{ width: '14%' }} />}
                        <col style={{ width: showLastMonthColumn ? '14%' : '18%' }} />
                        <col style={{ width: showLastMonthColumn ? '16%' : '16%' }} />
                    </colgroup>
                    <tbody>
                        {visibleRows.map((row) => (
                            <tr key={row.event_id} style={{ borderBottom: '1px solid #edf2f7' }}>
                                <td style={{ padding: '0.35rem 0.35rem' }}>{row.event_id}</td>
                                <td style={{ padding: '0.35rem 0.35rem' }}>
                                    {row.page_url ? (
                                        <a href={row.page_url} target="_blank" rel="noreferrer">
                                            {row.emergency_name}
                                        </a>
                                    ) : row.emergency_name}
                                </td>
                                <td style={{ padding: '0.35rem 0.35rem' }}>{row.total_page_views.toLocaleString('en-US')}</td>
                                {showLastMonthColumn && (
                                    <td style={{ padding: '0.35rem 0.35rem' }}>{(row.views_last_month ?? 0).toLocaleString('en-US')}</td>
                                )}
                                <td style={{ padding: '0.35rem 0.35rem' }}>{row.documents_download.toLocaleString('en-US')}</td>
                                <td style={{ padding: '0.35rem 0.35rem' }}>{row.avg_engagement_time_sec.toLocaleString('en-US')}</td>
                            </tr>
                        ))}
                        {visibleRows.length === 0 && (
                            <tr>
                                <td colSpan={showLastMonthColumn ? 6 : 5} style={{ padding: '0.65rem 0.5rem', color: '#64748b' }}>
                                    No emergencies match this search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            </div>
        </>
    );
}

function toPercentages(items: RankedItem[] | undefined) {
    const safeItems = items ?? [];
    const total = safeItems.reduce((acc, [, value]) => acc + value, 0);
    if (total <= 0) {
        return [] as { label: string; percentage: number }[];
    }
    return safeItems.map(([label, value]) => ({
        label,
        percentage: (value / total) * 100,
    }));
}

function AudienceInsightBox({
    title,
    items,
}: {
    title: string;
    items: RankedItem[] | undefined;
}) {
    const percentages = toPercentages(items).slice(0, 6);
    const formatLabel = (label: string) => {
        if (title.startsWith('Device')) {
            const normalized = label.trim().toLowerCase();
            if (normalized === 'mobile') {
                return 'Mobile';
            }
            if (normalized === 'desktop') {
                return 'Desktop';
            }
            if (normalized === 'tablet') {
                return 'Tablet';
            }
        }
        return label;
    };
    return (
        <div
            style={{
                border: '1px solid #dbe7f3',
                borderRadius: '10px',
                backgroundColor: '#f8fbff',
                padding: '0.7rem',
            }}
        >
            <p style={{ margin: '0 0 0.4rem 0', fontWeight: 700, color: '#1f2937' }}>{title}</p>
            {percentages.length === 0 && <p style={{ margin: 0, color: '#64748b' }}>No data</p>}
            {percentages.map((item) => (
                <div
                    key={item.label}
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '0.4rem',
                        fontSize: '0.85rem',
                        padding: '0.2rem 0',
                        borderBottom: '1px solid #e5edf7',
                    }}
                >
                    <span style={{ color: '#334155' }}>{formatLabel(item.label)}</span>
                    <strong style={{ color: '#0f172a' }}>
                        {item.percentage.toFixed(1)}
                        %
                    </strong>
                </div>
            ))}
        </div>
    );
}

function EngagementComparisonModule(props: {
    payload: EngagementComparisonPayload | undefined;
    onApply: (params: {
        mode: string;
        left: string;
        right: string;
        aStart: string;
        aEnd: string;
        bStart: string;
        bEnd: string;
    }) => void;
}) {
    const { payload, onApply } = props;
    const allowedModes = payload?.allowed_modes ?? ['country'];
    const [mode, setMode] = useState(payload?.mode ?? allowedModes[0] ?? 'country');
    const [left, setLeft] = useState(payload?.selected_left ?? '');
    const [right, setRight] = useState(payload?.selected_right ?? '');
    const [aStart, setAStart] = useState(payload?.period_a_start ?? '');
    const [aEnd, setAEnd] = useState(payload?.period_a_end ?? '');
    const [bStart, setBStart] = useState(payload?.period_b_start ?? '');
    const [bEnd, setBEnd] = useState(payload?.period_b_end ?? '');
    const options = payload?.options ?? [];
    const months = payload?.available_months ?? [];

    useEffect(() => {
        setMode(payload?.mode ?? allowedModes[0] ?? 'country');
        setLeft(payload?.selected_left ?? '');
        setRight(payload?.selected_right ?? '');
        setAStart(payload?.period_a_start ?? '');
        setAEnd(payload?.period_a_end ?? '');
        setBStart(payload?.period_b_start ?? '');
        setBEnd(payload?.period_b_end ?? '');
    }, [
        payload?.mode,
        payload?.selected_left,
        payload?.selected_right,
        payload?.period_a_start,
        payload?.period_a_end,
        payload?.period_b_start,
        payload?.period_b_end,
        allowedModes,
    ]);

    const formatOption = (value: string) => (mode === 'region' ? getRegionLabel(value) : value);
    const periodA = payload?.results?.period_a;
    const periodB = payload?.results?.period_b;

    return (
        <ModuleSection
            title="Engagement comparison"
            titleStyle={{ fontSize: '1.55rem', fontWeight: 800, color: '#1f2937', letterSpacing: '0.01em' }}
        >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>Mode</span>
                    <select value={mode} onChange={(e) => setMode(e.currentTarget.value)} style={{ width: '100%' }}>
                        {allowedModes.map((m) => <option key={m} value={m}>{m === 'region' ? 'Region' : 'Country'}</option>)}
                    </select>
                </label>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>Left</span>
                    <select value={left} onChange={(e) => setLeft(e.currentTarget.value)} style={{ width: '100%' }}>
                        {options.map((option) => <option key={option} value={option}>{formatOption(option)}</option>)}
                    </select>
                </label>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>Right</span>
                    <select value={right} onChange={(e) => setRight(e.currentTarget.value)} style={{ width: '100%' }}>
                        {options.map((option) => <option key={option} value={option}>{formatOption(option)}</option>)}
                    </select>
                </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>A from month</span>
                    <select value={aStart} onChange={(e) => setAStart(e.currentTarget.value)} style={{ width: '100%' }}>
                        {months.map((month) => <option key={`a-start-${month}`} value={month}>{formatMonthLabel(month)}</option>)}
                    </select>
                </label>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>A to month</span>
                    <select value={aEnd} onChange={(e) => setAEnd(e.currentTarget.value)} style={{ width: '100%' }}>
                        {months.map((month) => <option key={`a-end-${month}`} value={month}>{formatMonthLabel(month)}</option>)}
                    </select>
                </label>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>B from month</span>
                    <select value={bStart} onChange={(e) => setBStart(e.currentTarget.value)} style={{ width: '100%' }}>
                        {months.map((month) => <option key={`b-start-${month}`} value={month}>{formatMonthLabel(month)}</option>)}
                    </select>
                </label>
                <label>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#475569' }}>B to month</span>
                    <select value={bEnd} onChange={(e) => setBEnd(e.currentTarget.value)} style={{ width: '100%' }}>
                        {months.map((month) => <option key={`b-end-${month}`} value={month}>{formatMonthLabel(month)}</option>)}
                    </select>
                </label>
            </div>
            <button
                type="button"
                onClick={() => onApply({
                    mode,
                    left,
                    right,
                    aStart,
                    aEnd,
                    bStart,
                    bEnd,
                })}
                style={{ marginBottom: '0.65rem' }}
            >
                Apply comparison
            </button>
            <div style={{ border: '1px solid #dbe7f3', borderRadius: '8px', backgroundColor: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #dbe7f3', backgroundColor: '#f8fbff', textAlign: 'left' }}>
                            <th style={{ padding: '0.35rem' }}>Period</th>
                            <th style={{ padding: '0.35rem' }}>{formatOption(left || 'Left')}</th>
                            <th style={{ padding: '0.35rem' }}>{formatOption(right || 'Right')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style={{ borderBottom: '1px solid #edf2f7' }}>
                            <td style={{ padding: '0.35rem' }}>A Views</td>
                            <td style={{ padding: '0.35rem' }}>{(periodA?.left?.total_page_views ?? 0).toLocaleString('en-US')}</td>
                            <td style={{ padding: '0.35rem' }}>{(periodA?.right?.total_page_views ?? 0).toLocaleString('en-US')}</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #edf2f7' }}>
                            <td style={{ padding: '0.35rem' }}>A Avg Engagement Time</td>
                            <td style={{ padding: '0.35rem' }}>{(periodA?.left?.avg_engagement_time_sec ?? 0).toLocaleString('en-US')}s</td>
                            <td style={{ padding: '0.35rem' }}>{(periodA?.right?.avg_engagement_time_sec ?? 0).toLocaleString('en-US')}s</td>
                        </tr>
                        <tr style={{ borderBottom: '1px solid #edf2f7' }}>
                            <td style={{ padding: '0.35rem' }}>B Views</td>
                            <td style={{ padding: '0.35rem' }}>{(periodB?.left?.total_page_views ?? 0).toLocaleString('en-US')}</td>
                            <td style={{ padding: '0.35rem' }}>{(periodB?.right?.total_page_views ?? 0).toLocaleString('en-US')}</td>
                        </tr>
                        <tr>
                            <td style={{ padding: '0.35rem' }}>B Avg Engagement Time</td>
                            <td style={{ padding: '0.35rem' }}>{(periodB?.left?.avg_engagement_time_sec ?? 0).toLocaleString('en-US')}s</td>
                            <td style={{ padding: '0.35rem' }}>{(periodB?.right?.avg_engagement_time_sec ?? 0).toLocaleString('en-US')}s</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </ModuleSection>
    );
}

function getHeatColor(views: number, maxViews: number) {
    if (maxViews <= 0) {
        return '#eef2f7';
    }
    const ratio = views / maxViews;
    if (ratio <= 0) {
        return '#f3f4f6';
    }
    if (ratio <= 0.1) {
        return '#dbeafe';
    }
    if (ratio <= 0.25) {
        return '#93c5fd';
    }
    if (ratio <= 0.45) {
        return '#60a5fa';
    }
    if (ratio <= 0.7) {
        return '#2563eb';
    }
    if (ratio <= 0.9) {
        return '#1e40af';
    }
    return '#172554';
}

function MapHeatmapModule({ payload }: { payload: MapHeatmapPayload | undefined }) {
    const allCountryViews = payload?.country_views_all ?? [];
    const isoViews = payload?.country_views_iso3 ?? [];
    const canCityDrilldown = Boolean(payload?.can_city_drilldown);
    const cityViewsByCountry = payload?.city_views_by_country ?? {};
    const maxViews = Math.max(
        ...allCountryViews.map(([, views]) => views),
        ...isoViews.map((item) => item.views),
        0,
    );
    const viewsByIso3 = useMemo(
        () => {
            const mapping: Record<string, number> = {};
            isoViews.forEach((item) => {
                mapping[item.iso3.toUpperCase()] = item.views;
            });
            return mapping;
        },
        [isoViews],
    );
    const viewsByCountryName = useMemo(
        () => {
            const mapping: Record<string, number> = {};
            allCountryViews.forEach(([countryName, views]) => {
                mapping[normalizeCountryLabel(countryName)] = views;
            });
            return mapping;
        },
        [allCountryViews],
    );
    const cityViewsByCountryNormalized = useMemo(
        () => {
            const mapping: Record<string, RankedItem[]> = {};
            Object.entries(cityViewsByCountry).forEach(([countryName, cities]) => {
                mapping[normalizeCountryLabel(countryName)] = cities;
            });
            return mapping;
        },
        [cityViewsByCountry],
    );
    const [hoveredCountry, setHoveredCountry] = useState<string | undefined>();
    const [selectedCountry, setSelectedCountry] = useState<string | undefined>();
    const [zoom, setZoom] = useState(1.1);
    const [center, setCenter] = useState<[number, number]>([0, 15]);
    const WORLD_GEOJSON_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

    return (
        <ModuleSection
            title="Map"
            titleStyle={{ fontSize: '1.55rem', fontWeight: 800, color: '#1f2937', letterSpacing: '0.01em' }}
        >
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button
                    type="button"
                    onClick={() => setZoom((prev) => Math.min(8, Number((prev + 0.4).toFixed(2))))}
                    style={{
                        backgroundColor: '#fff',
                        color: '#1f2937',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '0.2rem 0.5rem',
                        fontWeight: 700,
                    }}
                >
                    +
                </button>
                <button
                    type="button"
                    onClick={() => setZoom((prev) => Math.max(1, Number((prev - 0.4).toFixed(2))))}
                    style={{
                        backgroundColor: '#fff',
                        color: '#1f2937',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '0.2rem 0.5rem',
                        fontWeight: 700,
                    }}
                >
                    -
                </button>
                <button
                    type="button"
                    onClick={() => {
                        setZoom(1.1);
                        setCenter([0, 15]);
                        if (canCityDrilldown) {
                            setSelectedCountry(undefined);
                        }
                    }}
                    style={{
                        backgroundColor: '#fff',
                        color: '#334155',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '0.2rem 0.5rem',
                        fontWeight: 600,
                    }}
                >
                    Reset view
                </button>
            </div>
            <div style={{ border: '1px solid #d6e6f5', borderRadius: '8px', overflow: 'hidden', backgroundColor: '#fff' }}>
                <ComposableMap
                    projectionConfig={{ scale: 130 }}
                    style={{ width: '100%', height: '30rem' }}
                >
                    <ZoomableGroup
                        zoom={zoom}
                        center={center}
                        minZoom={1.1}
                        maxZoom={8}
                        onMoveEnd={({ coordinates, zoom: nextZoom }) => {
                            setCenter([coordinates[0], coordinates[1]]);
                            setZoom(nextZoom);
                        }}
                    >
                        <Geographies geography={WORLD_GEOJSON_URL}>
                            {({ geographies }) => geographies.map((geo) => {
                                const countryName = String(geo.properties.name ?? geo.properties.NAME ?? '');
                                const viewsFromName = viewsByCountryName[normalizeCountryLabel(countryName)] ?? 0;
                                const iso3 = String(
                                    geo.id
                                    ?? geo.properties.ISO_A3
                                    ?? geo.properties.iso_a3
                                    ?? geo.properties.ADM0_A3
                                    ?? '',
                                ).toUpperCase();
                                const viewsFromIso = viewsByIso3[iso3] ?? 0;
                                const views = viewsFromIso || viewsFromName;
                                const fillColor = getHeatColor(views, maxViews);
                                return (
                                    <Geography
                                        key={geo.rsmKey}
                                        geography={geo}
                                        onClick={() => {
                                            if (canCityDrilldown) {
                                                setSelectedCountry(countryName || iso3);
                                                const nextCenter = getGeoApproxCenter(geo);
                                                if (nextCenter) {
                                                    setCenter(nextCenter);
                                                    setZoom(2.6);
                                                }
                                            }
                                        }}
                                        onMouseEnter={() => setHoveredCountry(
                                            `${countryName || iso3}: ${views.toLocaleString('en-US')} views`,
                                        )}
                                        onMouseLeave={() => setHoveredCountry(undefined)}
                                        style={{
                                            default: { fill: fillColor, stroke: '#fff', strokeWidth: 0.5 },
                                            hover: { fill: '#2563eb', stroke: '#fff', strokeWidth: 0.6 },
                                            pressed: { fill: '#1d4ed8', stroke: '#fff', strokeWidth: 0.6 },
                                        }}
                                    />
                                );
                            })}
                        </Geographies>
                    </ZoomableGroup>
                </ComposableMap>
            </div>
            <p style={{ marginTop: '0.5rem', marginBottom: '0.25rem', color: '#334155' }}>
                {hoveredCountry ?? 'Hover a country to see exact views'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.25rem', marginBottom: '0.35rem', fontSize: '0.75rem', color: '#64748b' }}>
                <span>0</span>
                {['#f3f4f6', '#dbeafe', '#93c5fd', '#60a5fa', '#2563eb', '#1e40af', '#172554'].map((color) => (
                    <span
                        key={color}
                        style={{
                            width: '1rem',
                            height: '0.5rem',
                            backgroundColor: color,
                            borderRadius: '3px',
                            border: '1px solid #cbd5e1',
                        }}
                    />
                ))}
                <span>{maxViews.toLocaleString('en-US')}</span>
            </div>
            {canCityDrilldown && selectedCountry && (
                <p style={{ marginTop: '0.25rem', marginBottom: '0.25rem', color: '#0f172a' }}>
                    Selected country:
                    {' '}
                    <strong>{selectedCountry}</strong>
                </p>
            )}
            {canCityDrilldown && selectedCountry && (
                <div
                    style={{
                        border: '1px solid #dbe7f3',
                        borderRadius: '8px',
                        backgroundColor: '#f8fbff',
                        padding: '0.6rem 0.75rem',
                        marginTop: '0.5rem',
                    }}
                >
                    <p style={{ margin: 0, fontWeight: 700 }}>
                        City heatmap (
                        {selectedCountry}
                        )
                    </p>
                    <p style={{ marginTop: '0.3rem', marginBottom: '0.2rem', color: '#475569', fontSize: '0.85rem' }}>
                        Based on viewer city counts in your scoped data
                    </p>
                    <KeyValueList items={
                        cityViewsByCountry[selectedCountry]
                        ?? cityViewsByCountryNormalized[normalizeCountryLabel(selectedCountry)]
                        ?? []
                    }
                    />
                </div>
            )}
            {!canCityDrilldown && (
                <p style={{ marginTop: '0.4rem', color: '#64748b', fontSize: '0.85rem' }}>
                    City-level drilldown is available for Regional Admin users only.
                </p>
            )}
            {isoViews.length === 0 && (
                <p style={{ marginTop: '0.5rem', color: '#64748b' }}>
                    No country view data available for the current filter.
                </p>
            )}
        </ModuleSection>
    );
}

function ModuleSection({
    title,
    children,
    titleStyle,
}: {
    title: string;
    children: ReactNode;
    titleStyle?: CSSProperties;
}) {
    return (
        <section
            style={{
                backgroundColor: '#fff',
                border: '1px solid #d6e6f5',
                borderRadius: '12px',
                padding: '0.9rem 1rem',
                marginBottom: '1rem',
            }}
        >
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.15rem', ...titleStyle }}>{title}</h3>
            {children}
        </section>
    );
}

function renderModule(
    moduleKey: string,
    data: unknown,
    isImOfficer: boolean,
    comparisonApply?: (params: {
        mode: string;
        left: string;
        right: string;
        aStart: string;
        aEnd: string;
        bStart: string;
        bEnd: string;
    }) => void,
) {
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
        return <MapHeatmapModule payload={data as MapHeatmapPayload | undefined} />;
    }

    if (moduleKey === 'engagement_performance') {
        const rows = (data as EngagementRow[]) ?? [];
        return (
            <ModuleSection
                title="Engagement performance"
                titleStyle={{ fontSize: '1.55rem', fontWeight: 800, color: '#1f2937', letterSpacing: '0.01em' }}
            >
                <EngagementPerformanceTable rows={rows} showLastMonthColumn={isImOfficer} />
            </ModuleSection>
        );
    }

    if (moduleKey === 'audience_insights') {
        const payload = data as {
            by_source?: RankedItem[];
            by_device?: RankedItem[];
            by_browser?: RankedItem[];
            by_os?: RankedItem[];
        };
        return (
            <ModuleSection
                title="Audience insights"
                titleStyle={{ fontSize: '1.55rem', fontWeight: 800, color: '#1f2937', letterSpacing: '0.01em' }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: '0.75rem',
                    }}
                >
                    <AudienceInsightBox title="Source (%)" items={payload?.by_source} />
                    <AudienceInsightBox title="Device (%)" items={payload?.by_device} />
                    <AudienceInsightBox title="Browser (%)" items={payload?.by_browser} />
                    <AudienceInsightBox title="OS (%)" items={payload?.by_os} />
                </div>
            </ModuleSection>
        );
    }

    if (moduleKey === 'live_spikes') {
        const rows = (data as {
            event_id: string;
            emergency_name: string;
            date: string;
            views: number;
            threshold: number;
            z_score: number;
        }[]) ?? [];
        return (
            <ModuleSection
                title="Live spikes"
                titleStyle={{ fontSize: '1.55rem', fontWeight: 800, color: '#1f2937', letterSpacing: '0.01em' }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        border: rows.length > 0 ? '1px solid #fecaca' : '1px solid #dbe7f3',
                        backgroundColor: rows.length > 0 ? '#fff1f2' : '#f8fbff',
                        color: rows.length > 0 ? '#9f1239' : '#334155',
                        borderRadius: '8px',
                        padding: '0.6rem 0.75rem',
                        marginBottom: '0.65rem',
                    }}
                >
                    <span role="img" aria-label="alert" style={{ fontSize: '1.2rem' }}>🚨</span>
                    <strong>
                        {rows.length > 0
                            ? 'Traffic spike alert detected'
                            : 'Anomalous spikes of page views will be shown below'}
                    </strong>
                </div>
                {rows.length > 0 ? (
                    <ol style={{ marginTop: 0 }}>
                        {rows.map((row) => (
                        <li key={`${row.event_id}-${row.date}`}>
                            {row.emergency_name}
                            {' (ID '}
                            {row.event_id}
                            {') — '}
                            {row.views.toLocaleString('en-US')}
                            {' views on '}
                            {row.date}
                            {' • unusually high activity compared with normal traffic (expected around '}
                            {Math.round(row.threshold).toLocaleString('en-US')}
                            {' views)'}
                        </li>
                        ))}
                    </ol>
                ) : (
                    <p style={{ margin: 0, color: '#64748b' }}>
                        No anomalous spikes detected right now.
                    </p>
                )}
            </ModuleSection>
        );
    }

    if (moduleKey === 'platform_adoption') {
        const payload = data as {
            monthly_breakdown?: {
                month: string;
                monthly_active_users: number;
                monthly_new_users: number;
                countries_publishing_pct: number;
                emergencies_created: number;
            }[];
        };
        return (
            <ModuleSection
                title="Platform adoption"
                titleStyle={{ fontSize: '1.55rem', fontWeight: 800, color: '#1f2937', letterSpacing: '0.01em' }}
            >
                <div style={{ border: '1px solid #dbe7f3', borderRadius: '8px', backgroundColor: '#fff' }}>
                    <div style={{ maxHeight: '18rem', overflow: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.86rem' }}>
                            <colgroup>
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '22%' }} />
                                <col style={{ width: '18%' }} />
                                <col style={{ width: '24%' }} />
                                <col style={{ width: '20%' }} />
                            </colgroup>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #dbe7f3', textAlign: 'left', backgroundColor: '#f8fbff' }}>
                                    <th style={{ padding: '0.35rem' }}>Month</th>
                                    <th style={{ padding: '0.35rem' }}>Active users</th>
                                    <th style={{ padding: '0.35rem' }}>New users</th>
                                    <th style={{ padding: '0.35rem' }}>Countries publishing (%)</th>
                                    <th style={{ padding: '0.35rem' }}>Emergency count</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(payload?.monthly_breakdown ?? []).map((row) => (
                                    <tr key={row.month} style={{ borderBottom: '1px solid #edf2f7' }}>
                                        <td style={{ padding: '0.35rem' }}>{row.month}</td>
                                        <td style={{ padding: '0.35rem' }}>{row.monthly_active_users.toLocaleString('en-US')}</td>
                                        <td style={{ padding: '0.35rem' }}>{row.monthly_new_users.toLocaleString('en-US')}</td>
                                        <td style={{ padding: '0.35rem' }}>{row.countries_publishing_pct.toLocaleString('en-US')}%</td>
                                        <td style={{ padding: '0.35rem' }}>{row.emergencies_created.toLocaleString('en-US')}</td>
                                    </tr>
                                ))}
                                {(payload?.monthly_breakdown ?? []).length === 0 && (
                                    <tr>
                                        <td colSpan={5} style={{ padding: '0.65rem 0.5rem', color: '#64748b' }}>
                                            No data
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </ModuleSection>
        );
    }

    if (moduleKey === 'engagement_comparison') {
        return (
            <EngagementComparisonModule
                payload={data as EngagementComparisonPayload | undefined}
                onApply={(params) => comparisonApply?.(params)}
            />
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
    const [appliedStartDate, setAppliedStartDate] = useState<string>('');
    const [appliedEndDate, setAppliedEndDate] = useState<string>('');
    const [cmpMode, setCmpMode] = useState<string>('');
    const [cmpLeft, setCmpLeft] = useState<string>('');
    const [cmpRight, setCmpRight] = useState<string>('');
    const [cmpAStart, setCmpAStart] = useState<string>('');
    const [cmpAEnd, setCmpAEnd] = useState<string>('');
    const [cmpBStart, setCmpBStart] = useState<string>('');
    const [cmpBEnd, setCmpBEnd] = useState<string>('');
    const {
        pending,
        error,
        response,
    } = useExternalRequest<AnalyticsResponse>({
        skip: !canViewAnalytics,
        url: '/api/v2/analytics/',
        query: {
            start_date: appliedStartDate || undefined,
            end_date: appliedEndDate || undefined,
            cmp_mode: cmpMode || undefined,
            cmp_left: cmpLeft || undefined,
            cmp_right: cmpRight || undefined,
            cmp_a_start: cmpAStart || undefined,
            cmp_a_end: cmpAEnd || undefined,
            cmp_b_start: cmpBStart || undefined,
            cmp_b_end: cmpBEnd || undefined,
        },
        preserveResponse: true,
    });
    const pageTitle = getAnalyticsPageTitle(response);
    const isImOfficer = response?.role_profile?.role === 'ops_im';
    const applyComparison = (params: {
        mode: string;
        left: string;
        right: string;
        aStart: string;
        aEnd: string;
        bStart: string;
        bEnd: string;
    }) => {
        setCmpMode(params.mode);
        setCmpLeft(params.left);
        setCmpRight(params.right);
        setCmpAStart(params.aStart);
        setCmpAEnd(params.aEnd);
        setCmpBStart(params.bStart);
        setCmpBEnd(params.bEnd);
    };

    return (
        <Page
            title={pageTitle}
            heading={pageTitle}
        >
            {!canViewAnalytics && (
                <p>You do not have analytics access.</p>
            )}
            {canViewAnalytics && (
                <div style={{ backgroundColor: '#F7F9FB', borderRadius: '12px', padding: '1rem' }}>
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
                            <div style={{ display: 'grid', gap: '1rem' }}>
                                {((response.available_modules ?? []).includes('views_by_date')
                                    || (response.available_modules ?? []).includes('map_heatmap')) && (
                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))',
                                            gap: '1rem',
                                            alignItems: 'start',
                                        }}
                                    >
                                        {(response.available_modules ?? []).includes('views_by_date') && (
                                            <ViewsByDateModule
                                                payload={response.module_data?.views_by_date as ViewsByDatePayload | undefined}
                                                selectedStartDate={response.filters_applied?.start_date}
                                                selectedEndDate={response.filters_applied?.end_date}
                                                onApplyRange={(startDate, endDate) => {
                                                    setAppliedStartDate(startDate);
                                                    setAppliedEndDate(endDate);
                                                }}
                                                onResetRange={() => {
                                                    setAppliedStartDate('');
                                                    setAppliedEndDate('');
                                                }}
                                            />
                                        )}
                                        {(response.available_modules ?? []).includes('map_heatmap')
                                            && renderModule('map_heatmap', response.module_data?.map_heatmap, isImOfficer)}
                                    </div>
                                )}
                                {((response.available_modules ?? []).includes('live_spikes')
                                    || (response.available_modules ?? []).includes('engagement_performance')) && (
                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'minmax(16rem, 0.7fr) minmax(32rem, 1.8fr)',
                                            gap: '1rem',
                                            alignItems: 'start',
                                        }}
                                    >
                                        {(response.available_modules ?? []).includes('live_spikes')
                                            && renderModule('live_spikes', response.module_data?.live_spikes, isImOfficer)}
                                        {(response.available_modules ?? []).includes('engagement_performance')
                                            && renderModule('engagement_performance', response.module_data?.engagement_performance, isImOfficer)}
                                    </div>
                                )}
                                {((response.available_modules ?? []).includes('platform_adoption')
                                    || (response.available_modules ?? []).includes('engagement_comparison')) && (
                                    <div
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: (
                                                (response.available_modules ?? []).includes('platform_adoption')
                                                && (response.available_modules ?? []).includes('engagement_comparison')
                                            )
                                                ? 'minmax(18rem, 0.85fr) minmax(30rem, 1.5fr)'
                                                : 'minmax(24rem, 1fr)',
                                            gap: '1rem',
                                            alignItems: 'start',
                                        }}
                                    >
                                        {(response.available_modules ?? []).includes('platform_adoption')
                                            && renderModule('platform_adoption', response.module_data?.platform_adoption, isImOfficer)}
                                        {(response.available_modules ?? []).includes('engagement_comparison')
                                            && renderModule(
                                                'engagement_comparison',
                                                response.module_data?.engagement_comparison,
                                                isImOfficer,
                                                applyComparison,
                                            )}
                                    </div>
                                )}
                                {(response.available_modules ?? [])
                                    .filter((moduleKey) => (
                                        moduleKey !== 'overview'
                                        && moduleKey !== 'views_by_date'
                                        && moduleKey !== 'map_heatmap'
                                        && moduleKey !== 'live_spikes'
                                        && moduleKey !== 'engagement_performance'
                                        && moduleKey !== 'platform_adoption'
                                        && moduleKey !== 'engagement_comparison'
                                        && moduleKey !== 'top_pages'
                                        && moduleKey !== 'top_countries'
                                        && moduleKey !== 'metadata_lookup'
                                    ))
                                    .map((moduleKey) => {
                                        const renderedModule = renderModule(
                                            moduleKey,
                                            response.module_data?.[moduleKey],
                                            isImOfficer,
                                        );
                                        if (!renderedModule) {
                                            return null;
                                        }
                                        return (
                                            <div key={moduleKey}>
                                                {renderedModule}
                                            </div>
                                        );
                                    })}
                            </div>
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
