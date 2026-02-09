import { useApiQuery, useApiMutation } from '../hooks/useApi';
import { ToggleSwitch } from './ToggleSwitch'; // Assuming this exists or I will create it
import { Shield, Server, Key } from 'lucide-react';

interface ConfigData {
    maintenanceMode: boolean;
    logLevel: string;
    uptime: number;
}

interface SecretData {
    key: string;
    configured: boolean;
    masked: string | null;
}

export function SettingsParams() {
    const { data: config, refetch: refetchConfig } = useApiQuery<ConfigData>('/api/config');
    const { data: secrets } = useApiQuery<SecretData[]>('/api/config/secrets');

    const { mutate: updateConfig } = useApiMutation<ConfigData, Partial<ConfigData>>('/api/config', 'PUT');

    const handleToggleMaintenance = async (enabled: boolean) => {
        await updateConfig({ maintenanceMode: enabled });
        refetchConfig();
    };

    const handleToggleDebug = async (enabled: boolean) => {
        await updateConfig({ logLevel: enabled ? 'debug' : 'info' });
        refetchConfig();
    };

    if (!config) return <div className="p-8 text-slate-500">Loading settings...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">

            {/* System Controls */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Server className="text-blue-400" size={20} />
                    System Controls
                </h3>

                <div className="space-y-4">
                    <ToggleSwitch
                        enabled={config.maintenanceMode}
                        onChange={handleToggleMaintenance}
                        label="Maintenance Mode"
                        description="Pause all agents. No new tasks will run."
                    />

                    <ToggleSwitch
                        enabled={config.logLevel === 'debug'}
                        onChange={handleToggleDebug}
                        label="Debug Logging"
                        description="Enable verbose output (for troubleshooting)."
                    />
                </div>
            </section>

            {/* Secrets & Security */}
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Shield className="text-green-400" size={20} />
                    Environment & Security
                </h3>

                <div className="grid gap-4">
                    {secrets?.map(secret => (
                        <div key={secret.key} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                            <div className="flex items-center gap-3">
                                <Key size={16} className="text-slate-500" />
                                <span className="font-mono text-sm text-slate-300">{secret.key}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {secret.configured ? (
                                    <span className="text-xs font-mono text-green-400 bg-green-500/10 px-2 py-1 rounded">
                                        {secret.masked}
                                    </span>
                                ) : (
                                    <span className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                                        Not Configured
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Info */}
            <div className="text-center text-xs text-slate-600 font-mono mt-8">
                NanoGemClaw v1.0.0 • Uptime: {Math.floor(config.uptime / 60)}m
            </div>

        </div>
    );
}
