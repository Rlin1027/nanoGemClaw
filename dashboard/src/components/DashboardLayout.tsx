import { LayoutDashboard, TerminalSquare, Settings, Database, Plus, CalendarClock, BarChart3 } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useApiQuery } from "../hooks/useApi";

interface DashboardLayoutProps {
    children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const navigate = useNavigate();

    const { data: groupsData } = useApiQuery<{ groups: any[] }>('/api/groups');
    const { data: errorsData } = useApiQuery<any[]>('/api/errors');
    const { data: configData } = useApiQuery<{ maintenanceMode: boolean }>('/api/config');

    const groupCount = groupsData?.groups?.length ?? 0;
    const hasErrors = (errorsData?.length ?? 0) > 0;
    const errorCount = errorsData?.length ?? 0;
    const isMaintenance = configData?.maintenanceMode ?? false;

    const overviewBadge = (
        <span className="flex items-center gap-1.5">
            {groupCount > 0 && (
                <span className="text-[10px] font-bold bg-slate-700 text-slate-300 rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {groupCount}
                </span>
            )}
            {hasErrors && <span className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_6px_rgba(239,68,68,0.6)]" />}
        </span>
    );

    const logsBadge = errorCount > 0 ? (
        <span className="text-[10px] font-bold bg-red-500/20 text-red-400 rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {errorCount}
        </span>
    ) : null;

    const settingsBadge = isMaintenance ? (
        <span className="w-2 h-2 bg-yellow-500 rounded-full shadow-[0_0_6px_rgba(234,179,8,0.6)]" />
    ) : null;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-200 flex font-sans selection:bg-blue-500/30">
            {/* Sidebar */}
            <aside className="w-16 lg:w-64 border-r border-slate-800 flex flex-col fixed h-full bg-slate-950 z-10 transition-all duration-300">
                <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-slate-800">
                    <div className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-lg shadow-lg shadow-blue-500/20" />
                    <span className="hidden lg:block ml-3 font-bold text-lg tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                        GemClaw
                    </span>
                </div>

                <nav className="flex-1 p-2 space-y-2 mt-4">
                    <NavItem to="/" icon={<LayoutDashboard size={20} />} label="Overview" badge={overviewBadge} />
                    <NavItem to="/logs" icon={<TerminalSquare size={20} />} label="Logs" badge={logsBadge} />
                    <NavItem to="/memory" icon={<Database size={20} />} label="Memory" />
                    <NavItem to="/tasks" icon={<CalendarClock size={20} />} label="Tasks" />
                    <NavItem to="/analytics" icon={<BarChart3 size={20} />} label="Analytics" />
                    <NavItem to="/settings" icon={<Settings size={20} />} label="Settings" badge={settingsBadge} />
                </nav>

                <div className="p-4 border-t border-slate-800 hidden lg:block">
                    <button
                        onClick={() => navigate('/')}
                        className="flex items-center gap-2 w-full bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
                    >
                        <Plus size={16} /> Add Group
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 ml-16 lg:ml-64 p-4 lg:p-8 overflow-y-auto">
                <header className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
                        <p className="text-slate-400 text-sm mt-1">Real-time Command Center</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-full text-green-400 text-xs font-mono">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            ONLINE
                        </div>
                    </div>
                </header>

                {children}
            </main>
        </div>
    );
}

function NavItem({ to, icon, label, badge }: { to: string; icon: React.ReactNode; label: string; badge?: React.ReactNode }) {
    return (
        <NavLink
            to={to}
            end={to === '/'}
            className={({ isActive }: { isActive: boolean }) => cn(
                "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group",
                isActive
                    ? "bg-slate-800 text-white shadow-inner"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/50"
            )}
        >
            {({ isActive }: { isActive: boolean }) => (
                <>
                    <span className={cn("transition-colors", isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300")}>
                        {icon}
                    </span>
                    <span className="hidden lg:block text-sm font-medium">{label}</span>
                    <span className="ml-auto hidden lg:flex items-center gap-2">
                        {badge}
                        {isActive && <div className="w-1 h-1 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
                    </span>
                </>
            )}
        </NavLink>
    );
}
