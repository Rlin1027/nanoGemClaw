import { useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { cn } from '@/lib/utils';

interface TaskFormModalProps {
    groups: { id: string; name: string }[];
    defaultGroup?: string;
    onClose: () => void;
    onCreated: () => void;
}

export function TaskFormModal({ groups, defaultGroup, onClose, onCreated }: TaskFormModalProps) {
    const [form, setForm] = useState({
        group_folder: defaultGroup || groups[0]?.id || '',
        prompt: '',
        schedule_type: 'cron' as 'cron' | 'interval' | 'once',
        schedule_value: '',
        context_mode: 'isolated' as 'group' | 'isolated',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await apiFetch('/api/tasks', {
                method: 'POST',
                body: JSON.stringify(form),
            });
            onCreated();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create task');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <h2 className="text-lg font-bold text-slate-100">Create Scheduled Task</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    {/* Group */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Group</label>
                        <select
                            value={form.group_folder}
                            onChange={e => setForm(f => ({ ...f, group_folder: e.target.value }))}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                        >
                            {groups.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Prompt */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Prompt</label>
                        <textarea
                            value={form.prompt}
                            onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
                            rows={3}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 resize-none"
                            placeholder="Enter the task prompt..."
                        />
                    </div>

                    {/* Schedule Type */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Schedule Type</label>
                        <div className="flex gap-2">
                            {(['cron', 'interval', 'once'] as const).map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, schedule_type: type, schedule_value: '' }))}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                                        form.schedule_type === type
                                            ? "bg-blue-600 text-white"
                                            : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Schedule Value */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">
                            {form.schedule_type === 'cron' ? 'Cron Expression' :
                             form.schedule_type === 'interval' ? 'Interval (ms)' : 'Run At (ISO)'}
                        </label>
                        <input
                            value={form.schedule_value}
                            onChange={e => setForm(f => ({ ...f, schedule_value: e.target.value }))}
                            required
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200"
                            placeholder={
                                form.schedule_type === 'cron' ? '0 9 * * *' :
                                form.schedule_type === 'interval' ? '3600000' : '2025-12-31T00:00:00Z'
                            }
                        />
                    </div>

                    {/* Context Mode */}
                    <div>
                        <label className="text-sm text-slate-400 block mb-1">Context Mode</label>
                        <div className="flex gap-2">
                            {(['isolated', 'group'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setForm(f => ({ ...f, context_mode: mode }))}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                                        form.context_mode === mode
                                            ? "bg-blue-600 text-white"
                                            : "bg-slate-800 text-slate-400 hover:text-slate-200"
                                    )}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <div className="text-red-400 text-sm">{error}</div>}

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2 rounded-lg text-sm font-medium transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                            {loading ? 'Creating...' : 'Create Task'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
