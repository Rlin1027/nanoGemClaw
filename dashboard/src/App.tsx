import { Routes, Route } from 'react-router-dom';
import { DashboardLayout } from './components/DashboardLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverviewPage } from './pages/OverviewPage';
import { LogsPage } from './pages/LogsPage';
import { MemoryPage } from './pages/MemoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { useSocket } from './hooks/useSocket';

function App() {
    const { groups, isConnected } = useSocket();

    return (
        <DashboardLayout>
            <ErrorBoundary>
                <Routes>
                    <Route path="/" element={<OverviewPage groups={groups} isConnected={isConnected} />} />
                    <Route path="/logs" element={<LogsPage />} />
                    <Route path="/memory" element={<MemoryPage groups={groups} />} />
                    <Route path="/settings" element={<SettingsPage />} />
                </Routes>
            </ErrorBoundary>
        </DashboardLayout>
    );
}

export default App;
