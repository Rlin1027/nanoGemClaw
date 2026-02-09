import { useApiQuery, useApiMutation } from './useApi';

export interface KnowledgeDoc {
    id: number;
    group_folder: string;
    filename: string;
    title: string;
    content: string;
    size_chars: number;
    created_at: string;
    updated_at: string;
}

export function useKnowledgeDocs(groupFolder: string) {
    return useApiQuery<KnowledgeDoc[]>(`/api/groups/${groupFolder}/knowledge`);
}

export function useCreateKnowledgeDoc(groupFolder: string) {
    return useApiMutation<KnowledgeDoc, { filename: string; title: string; content: string }>(
        `/api/groups/${groupFolder}/knowledge`,
        'POST'
    );
}

export function useUpdateKnowledgeDoc(groupFolder: string, docId: number) {
    return useApiMutation<KnowledgeDoc, { title: string; content: string }>(
        `/api/groups/${groupFolder}/knowledge/${docId}`,
        'PUT'
    );
}

export function useDeleteKnowledgeDoc(groupFolder: string, docId: number) {
    return useApiMutation<{ success: boolean }, void>(
        `/api/groups/${groupFolder}/knowledge/${docId}`,
        'DELETE'
    );
}
