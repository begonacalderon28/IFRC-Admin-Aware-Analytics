import Page from '#components/Page';
import usePermissions from '#hooks/domain/usePermissions';
import useUserMe from '#hooks/domain/useUserMe';

/** @knipignore */
// eslint-disable-next-line import/prefer-default-export
export function Component() {
    const userMe = useUserMe();
    const { canViewAnalytics } = usePermissions();

    const regions = userMe?.analytics_regions ?? [];

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
                    <p>
                        <strong>Global access:</strong>
                        {' '}
                        {userMe?.analytics_global ? 'Yes' : 'No'}
                    </p>
                    <p>
                        <strong>Live emergency access:</strong>
                        {' '}
                        {userMe?.analytics_live ? 'Yes' : 'No'}
                    </p>
                    <p>
                        <strong>Regional access:</strong>
                        {' '}
                        {regions.length > 0 ? regions.join(', ') : 'None'}
                    </p>
                </div>
            )}
        </Page>
    );
}

Component.displayName = 'Analytics';
