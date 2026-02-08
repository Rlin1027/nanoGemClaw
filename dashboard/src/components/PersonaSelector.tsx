import { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import { cn } from '@/lib/utils';

interface Persona {
    name: string;
    description: string;
    systemPrompt: string;
}

interface PersonaSelectorProps {
    value?: string;
    onChange: (key: string) => void;
    disabled?: boolean;
}

export function PersonaSelector({ value, onChange, disabled }: PersonaSelectorProps) {
    const [personas, setPersonas] = useState<Record<string, Persona>>({});

    useEffect(() => {
        apiFetch<{ data: Record<string, Persona> }>('/api/personas')
            .then(res => setPersonas(res.data))
            .catch(() => {});
    }, []);

    return (
        <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800">
            <label className="text-sm font-medium text-slate-200 block mb-2">Persona</label>
            <select
                value={value || 'default'}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                className={cn(
                    "w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500/50",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
            >
                {Object.entries(personas).map(([key, p]) => (
                    <option key={key} value={key}>
                        {p.name} — {p.description}
                    </option>
                ))}
            </select>
        </div>
    );
}
