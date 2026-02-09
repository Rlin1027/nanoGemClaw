import { useState } from 'react';
import { FileText, Plus, Trash2, Save, Search, BookOpen, Edit, X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSocket } from '../hooks/useSocket';
import { useKnowledgeDocs, useCreateKnowledgeDoc, useUpdateKnowledgeDoc, useDeleteKnowledgeDoc, type KnowledgeDoc } from '../hooks/useKnowledge';

export function KnowledgePage() {
    const { groups } = useSocket();
    const [selectedGroupFolder, setSelectedGroupFolder] = useState<string>(groups[0]?.id || '');
    const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [editTitle, setEditTitle] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const { data: docs, isLoading, refetch } = useKnowledgeDocs(selectedGroupFolder);
    const createMutation = useCreateKnowledgeDoc(selectedGroupFolder);
    const updateMutation = useUpdateKnowledgeDoc(selectedGroupFolder, selectedDoc?.id || 0);
    const deleteMutation = useDeleteKnowledgeDoc(selectedGroupFolder, selectedDoc?.id || 0);

    const filteredDocs = (docs || []).filter(doc =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totalSize = (docs || []).reduce((sum, doc) => sum + doc.size_chars, 0);

    const handleSelectDoc = (doc: KnowledgeDoc) => {
        setSelectedDoc(doc);
        setEditTitle(doc.title);
        setEditContent(doc.content);
        setIsEditing(false);
    };

    const handleSave = async () => {
        if (!selectedDoc) return;
        const result = await updateMutation.mutate({ title: editTitle, content: editContent });
        if (result) {
            await refetch();
            setSelectedDoc(result);
            setIsEditing(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedDoc) return;
        const result = await deleteMutation.mutate(undefined);
        if (result) {
            await refetch();
            setSelectedDoc(null);
            setShowDeleteConfirm(false);
        }
    };

    const handleCreate = async (filename: string, title: string, content: string) => {
        const result = await createMutation.mutate({ filename, title, content });
        if (result) {
            await refetch();
            setShowCreateModal(false);
            handleSelectDoc(result);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <BookOpen size={24} className="text-blue-400" />
                        Knowledge Base
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">
                        {totalSize.toLocaleString()} chars across {(docs || []).length} documents
                    </p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    disabled={!selectedGroupFolder}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus size={16} /> New Document
                </button>
            </div>

            {/* Group Selector and Search */}
            <div className="flex gap-3">
                <select
                    value={selectedGroupFolder}
                    onChange={e => {
                        setSelectedGroupFolder(e.target.value);
                        setSelectedDoc(null);
                    }}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
                >
                    <option value="">Select a group</option>
                    {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search documents..."
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                </div>
            </div>

            {/* Main Content */}
            {!selectedGroupFolder ? (
                <div className="flex items-center justify-center py-20 text-slate-500 bg-slate-900/30 rounded-xl border-2 border-dashed border-slate-800">
                    Select a group to view knowledge base
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-20rem)]">
                    {/* Document List */}
                    <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 overflow-y-auto">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Documents</h3>
                        {isLoading ? (
                            <div className="text-slate-500 text-center py-8 text-sm">Loading...</div>
                        ) : filteredDocs.length === 0 ? (
                            <div className="text-slate-500 text-center py-8 text-sm">
                                {searchQuery ? 'No matching documents' : 'No documents yet'}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredDocs.map(doc => (
                                    <button
                                        key={doc.id}
                                        onClick={() => handleSelectDoc(doc)}
                                        className={cn(
                                            'w-full text-left p-3 rounded-lg transition-all',
                                            selectedDoc?.id === doc.id
                                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100'
                                        )}
                                    >
                                        <div className="flex items-start gap-2">
                                            <FileText size={16} className="mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm truncate">{doc.title}</div>
                                                <div className="text-xs opacity-70 mt-1 truncate">{doc.filename}</div>
                                                <div className="text-xs opacity-60 mt-1">
                                                    {doc.size_chars.toLocaleString()} chars
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Editor/Viewer */}
                    <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                        {!selectedDoc ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500">
                                Select a document to view or edit
                            </div>
                        ) : (
                            <>
                                {/* Document Header */}
                                <div className="border-b border-slate-800 p-4 flex items-center justify-between">
                                    <div className="flex-1 min-w-0">
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={editTitle}
                                                onChange={e => setEditTitle(e.target.value)}
                                                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                            />
                                        ) : (
                                            <>
                                                <h3 className="text-white font-semibold truncate">{selectedDoc.title}</h3>
                                                <p className="text-slate-400 text-xs mt-1">{selectedDoc.filename}</p>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 ml-4">
                                        {isEditing ? (
                                            <>
                                                <button
                                                    onClick={handleSave}
                                                    disabled={updateMutation.isLoading}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                                                >
                                                    <Save size={14} /> Save
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setIsEditing(false);
                                                        setEditTitle(selectedDoc.title);
                                                        setEditContent(selectedDoc.content);
                                                    }}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    <X size={14} /> Cancel
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => setIsEditing(true)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    <Edit size={14} /> Edit
                                                </button>
                                                <button
                                                    onClick={() => setShowDeleteConfirm(true)}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    <Trash2 size={14} /> Delete
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Content Area */}
                                <div className="flex-1 p-4 overflow-y-auto">
                                    {isEditing ? (
                                        <textarea
                                            value={editContent}
                                            onChange={e => setEditContent(e.target.value)}
                                            className="w-full h-full bg-slate-950 border border-slate-800 rounded-lg p-4 text-slate-200 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                            placeholder="Enter markdown content..."
                                        />
                                    ) : (
                                        <pre className="text-slate-300 text-sm font-mono whitespace-pre-wrap break-words">
                                            {selectedDoc.content}
                                        </pre>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <CreateDocumentModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreate}
                    isLoading={createMutation.isLoading}
                />
            )}

            {/* Delete Confirmation */}
            {showDeleteConfirm && selectedDoc && (
                <DeleteConfirmModal
                    docTitle={selectedDoc.title}
                    onClose={() => setShowDeleteConfirm(false)}
                    onConfirm={handleDelete}
                    isLoading={deleteMutation.isLoading}
                />
            )}
        </div>
    );
}

interface CreateDocumentModalProps {
    onClose: () => void;
    onCreate: (filename: string, title: string, content: string) => void;
    isLoading: boolean;
}

function CreateDocumentModal({ onClose, onCreate, isLoading }: CreateDocumentModalProps) {
    const [filename, setFilename] = useState('');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!filename.trim() || !title.trim()) return;
        const finalFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
        onCreate(finalFilename, title, content);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-2xl m-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-white mb-4">Create New Document</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-slate-300 text-sm font-medium mb-2">Filename</label>
                        <input
                            type="text"
                            value={filename}
                            onChange={e => setFilename(e.target.value)}
                            placeholder="example.md"
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-slate-300 text-sm font-medium mb-2">Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="Document Title"
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-slate-300 text-sm font-medium mb-2">Content (Markdown)</label>
                        <textarea
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            placeholder="# Heading&#10;&#10;Content here..."
                            rows={10}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                        />
                    </div>
                    <div className="flex gap-3 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading || !filename.trim() || !title.trim()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

interface DeleteConfirmModalProps {
    docTitle: string;
    onClose: () => void;
    onConfirm: () => void;
    isLoading: boolean;
}

function DeleteConfirmModal({ docTitle, onClose, onConfirm, isLoading }: DeleteConfirmModalProps) {
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md m-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-start gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
                        <AlertCircle size={20} className="text-red-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">Delete Document</h3>
                        <p className="text-slate-400 text-sm mt-1">
                            Are you sure you want to delete <span className="font-medium text-slate-300">{docTitle}</span>? This action cannot be undone.
                        </p>
                    </div>
                </div>
                <div className="flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Deleting...' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
}
