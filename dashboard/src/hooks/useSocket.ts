import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { AgentStatus } from '../components/StatusCard';

const SERVER_URL = import.meta.env.VITE_API_URL || window.location.origin;

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
    const [logs, setLogs] = useState<string[]>([]);

    useEffect(() => {
        const socketInstance = io(SERVER_URL);

        socketInstance.on('connect', () => {
            console.log('Connected to Dashboard Server');
            setIsConnected(true);
        });

        socketInstance.on('disconnect', () => {
            console.log('Disconnected from Dashboard Server');
            setIsConnected(false);
        });

        socketInstance.on('groups:update', (data: GroupData[]) => {
            console.log('Received groups update:', data);
            setGroups(data);
        });

        socketInstance.on('logs:history', (history: string[]) => {
            setLogs(history);
        });

        socketInstance.on('logs:entry', (entry: string) => {
            setLogs(prev => [...prev, entry]);
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    return { socket, isConnected, groups, logs };
}
