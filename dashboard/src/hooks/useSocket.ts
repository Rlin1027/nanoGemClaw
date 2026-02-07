import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { AgentStatus } from '../components/StatusCard';

const SERVER_URL = import.meta.env.VITE_API_URL || '';

export interface GroupData {
    id: string;
    name: string;
    status: AgentStatus;
    messageCount: number;
    activeTasks: number;
}

export function useSocket() {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [groups, setGroups] = useState<GroupData[]>([]);

    useEffect(() => {
        const socketInstance = io(SERVER_URL || window.location.origin);

        socketInstance.on('connect', () => {
            console.log('Connected to Dashboard Server');
            setIsConnected(true);
        });

        socketInstance.on('disconnect', () => {
            console.log('Disconnected from Dashboard Server');
            setIsConnected(false);
        });

        socketInstance.on('groups:update', (data: GroupData[]) => {
            setGroups(data);
        });

        // Real-time agent status updates
        socketInstance.on('agent:status', (data: { groupFolder: string; status: AgentStatus; error?: string }) => {
            setGroups(prev => prev.map(g =>
                g.id === data.groupFolder ? { ...g, status: data.status } : g
            ));
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    return { socket, isConnected, groups };
}
