import { useState } from 'react';
import { useApiQuery } from '../hooks/useApi';
import { useSocket } from '../hooks/useSocket';
import { UsageChart } from '../components/UsageChart';
import { StatsCards } from '../components/StatsCards';

type Period = '1d' | '7d' | '30d';

export function AnalyticsPage() {
    const { groups } = useSocket();
    const [period, setPeriod] = useState<Period>('7d');
    const [groupFilter, setGroupFilter] = useState('');

    const timeseriesUrl = `/api/usage/timeseries?period=${period}${groupFilter ? `&groupFolder=${groupFilter}` : ''}`;
    const { data: timeseries } = useApiQuery<any[]>(timeseriesUrl);
    const { data: byGroup } = useApiQuery<any[]>('/api/usage/groups');
    const { data: usage } = useApiQuery<any>('/api/usage');
    const { data: recent } = useApiQuery<any[]>('/api/usage/recent');

    const totalTokens = usage ? usage.total_prompt_tokens + usage.total_response_tokens : 0;
    const avgTime = usage && usage.total_requests > 0 ? (usage.avg_duration_ms / 1000).toFixed(1) + 's' : 'N/A';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">Analytics</h2>
                <div className="flex items-center gap-3">
                    <select
                        value={groupFilter}
                        onChange={e => setGroupFilter(e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                    >
                        <option value="">All Groups</option>
                        {groups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                    <div className="flex bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
                        {(['1d', '7d', '30d'] as Period[]).map(p => (
                            <button
                                key={p}
                                onClick={() => setPeriod(p)}
                                className={`px-3 py-2 text-sm font-medium transition-colors ${
                                    period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {p === '1d' ? 'Today' : p === '7d' ? '7 Days' : '30 Days'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Stats */}
            <StatsCards stats={[
                { label: 'Total Requests', value: usage?.total_requests ?? 0 },
                { label: 'Total Tokens', value: totalTokens.toLocaleString() },
                { label: 'Avg Response', value: avgTime },
                { label: 'Groups Active', value: (byGroup || []).length },
            ]} />

            {/* Token Usage Over Time */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Token Usage Over Time</h3>
                <UsageChart
                    data={timeseries || []}
                    type="line"
                    dataKeys={[
                        { key: 'prompt_tokens', color: '#60a5fa', name: 'Prompt Tokens' },
                        { key: 'response_tokens', color: '#34d399', name: 'Response Tokens' },
                    ]}
                />
            </div>

            {/* Requests by Group */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Requests by Group</h3>
                <UsageChart
                    data={byGroup || []}
                    type="bar"
                    xKey="group_folder"
                    dataKeys={[
                        { key: 'requests', color: '#818cf8', name: 'Requests' },
                    ]}
                    height={250}
                />
            </div>

            {/* Recent Requests */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                <h3 className="text-sm font-medium text-slate-400 mb-4">Recent Requests</h3>
                <div className="space-y-2">
                    {(recent || []).map((entry: any, i: number) => (
                        <div key={i} className="flex items-center gap-4 text-sm py-2 border-b border-slate-800/50 last:border-0">
                            <span className="text-slate-500 w-40">{new Date(entry.timestamp).toLocaleString()}</span>
                            <span className="text-slate-300 flex-1">{entry.group_folder}</span>
                            <span className="text-slate-500 font-mono">{((entry.duration_ms || 0) / 1000).toFixed(1)}s</span>
                            <span className="text-slate-500 font-mono">
                                {(entry.prompt_tokens || 0) + (entry.response_tokens || 0)} tok
                            </span>
                        </div>
                    ))}
                    {(recent || []).length === 0 && (
                        <div className="text-slate-500 text-center py-4">No recent requests</div>
                    )}
                </div>
            </div>
        </div>
    );
}
