'use client';

import { useState, useEffect } from 'react';
import { Brain, Tag, Edit2, Trash2, Plus, Search } from 'lucide-react';
import Card from '@/components/ui/Card';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Modal from '@/components/ui/Modal';
import TextField from '@/components/ui/TextField';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import FormField from '@/components/patterns/FormField';
import type { FamilyMemory, MemoryCategory } from '@/lib/family-memory';

interface FamilyMemoryBrowserProps {
  familyId: string;
}

export function FamilyMemoryBrowser({ familyId }: FamilyMemoryBrowserProps) {
  const [memories, setMemories] = useState<FamilyMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | 'all'>('all');
  const [editingMemory, setEditingMemory] = useState<FamilyMemory | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    loadMemories();
  }, [familyId, selectedCategory, searchQuery]);

  const loadMemories = async () => {
    setLoading(true);
    setError(null);

    try {
      let url = `/api/family-memory?familyId=${familyId}`;
      
      if (selectedCategory !== 'all') {
        url += `&category=${selectedCategory}`;
      }
      
      if (searchQuery) {
        url += `&search=${encodeURIComponent(searchQuery)}`;
      }

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to load memories');
      }

      const data = await response.json();
      setMemories(data.memories || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (memoryId: string) => {
    try {
      const response = await fetch(`/api/family-memory/${memoryId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setDeleteConfirm(null);
        await loadMemories();
      }
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleUpdate = async (memoryId: string, updates: Partial<FamilyMemory>) => {
    try {
      const response = await fetch(`/api/family-memory/${memoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        setEditingMemory(null);
        await loadMemories();
      }
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  const handleAdd = async (memory: Omit<FamilyMemory, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>) => {
    try {
      const response = await fetch('/api/family-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...memory, familyId }),
      });

      if (response.ok) {
        setShowAddForm(false);
        await loadMemories();
      }
    } catch (err) {
      console.error('Failed to add memory:', err);
    }
  };

  const categories: Array<{ value: MemoryCategory | 'all'; label: string; icon: string }> = [
    { value: 'all', label: 'All', icon: '📋' },
    { value: 'preference', label: 'Preferences', icon: '⭐' },
    { value: 'allergy', label: 'Allergies', icon: '⚠️' },
    { value: 'routine', label: 'Routines', icon: '🔄' },
    { value: 'location', label: 'Locations', icon: '📍' },
    { value: 'schedule', label: 'Schedule', icon: '📅' },
    { value: 'personality', label: 'Personality', icon: '👤' },
    { value: 'restriction', label: 'Restrictions', icon: '🚫' },
    { value: 'contact', label: 'Contacts', icon: '📞' },
    { value: 'note', label: 'Notes', icon: '📝' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2 text-text-primary">
          <Brain className="h-6 w-6 text-[var(--color-accent-selected)]" />
          Family Memory Bank
        </h2>
        <Button onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4" />
          Add Memory
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
          <TextField
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <Button
            key={cat.value}
            variant={selectedCategory === cat.value ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSelectedCategory(cat.value)}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
          </Button>
        ))}
      </div>

      {/* Memory List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} padding="md">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 mb-1" />
                  <Skeleton className="h-3 w-48 mb-1" />
                  <Skeleton className="h-4 w-full" />
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <Skeleton className="h-8 w-8 rounded-lg" />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 w-20 rounded" />
                <Skeleton className="h-5 w-24 rounded" />
              </div>
              <div className="flex items-center gap-4 mt-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </Card>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Unable to Load Memories"
          description={error}
          icon="🧠"
          actionLabel="Retry"
          onAction={loadMemories}
        />
      ) : memories.length === 0 ? (
        <EmptyState
          title="No Memories Found"
          description={
            searchQuery || selectedCategory !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Start adding family memories to help Consuela provide personalized assistance'
          }
          icon="🧠"
          actionLabel={!searchQuery && selectedCategory === 'all' ? 'Add Memory' : undefined}
          onAction={!searchQuery && selectedCategory === 'all' ? () => setShowAddForm(true) : undefined}
        />
      ) : (
        <div className="space-y-3">
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onEdit={() => setEditingMemory(memory)}
              onDelete={() => setDeleteConfirm(memory.id)}
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingMemory && (
        <EditMemoryModal
          memory={editingMemory}
          onSave={(updates) => handleUpdate(editingMemory.id, updates)}
          onCancel={() => setEditingMemory(null)}
        />
      )}

      {/* Add Modal */}
      {showAddForm && (
        <AddMemoryModal
          familyId={familyId}
          onSave={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <Modal
          open={true}
          onClose={() => setDeleteConfirm(null)}
          title="Delete Memory"
          description="Are you sure you want to delete this memory? This action cannot be undone."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => handleDelete(deleteConfirm)}>
                Delete
              </Button>
            </>
          }
        >
          <div className="py-4">
            <p className="text-sm text-text-secondary">
              This memory will be permanently removed from your family memory bank.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MemoryCard({ memory, onEdit, onDelete }: {
  memory: FamilyMemory;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tags = typeof memory.tags === 'string' ? JSON.parse(memory.tags) : memory.tags;

  const categoryLabels: Record<string, string> = {
    preference: '⭐ Preference',
    allergy: '⚠️ Allergy',
    routine: '🔄 Routine',
    location: '📍 Location',
    schedule: '📅 Schedule',
    personality: '👤 Personality',
    restriction: '🚫 Restriction',
    contact: '📞 Contact',
    note: '📝 Note',
  };

  return (
    <Card padding="md">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-text-secondary">
              {categoryLabels[memory.category] || memory.category}
            </span>
            <span className="text-xs bg-surface-2 px-2 py-0.5 rounded text-text-secondary">
              {Math.round(memory.confidence * 100)}% confidence
            </span>
          </div>
          <p className="text-text-primary">{memory.content}</p>
        </div>
        <div className="flex items-center gap-1 ml-4">
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label="Edit memory"
          >
            <Edit2 className="h-4 w-4" />
          </IconButton>
          <IconButton
            variant="danger"
            size="sm"
            onClick={onDelete}
            aria-label="Delete memory"
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <Tag className="h-3 w-3 text-text-secondary" />
          <div className="flex flex-wrap gap-1">
            {tags.map((tag: string) => (
              <Surface
                key={tag}
                variant="flat"
                radius="sm"
                padding="none"
                className="text-xs px-2 py-0.5"
              >
                <span className="text-[var(--color-accent-selected)]">{tag}</span>
              </Surface>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 mt-3 text-xs text-text-secondary">
        <span>Used {memory.usageCount} times</span>
        {memory.lastUsed && (
          <span>Last used {new Date(memory.lastUsed).toLocaleDateString()}</span>
        )}
      </div>
    </Card>
  );
}

function EditMemoryModal({ memory, onSave, onCancel }: {
  memory: FamilyMemory;
  onSave: (updates: Partial<FamilyMemory>) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(memory.content);
  const [tags, setTags] = useState<string[]>(
    typeof memory.tags === 'string' ? JSON.parse(memory.tags) : memory.tags
  );
  const [confidence, setConfidence] = useState(memory.confidence);
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  return (
    <Modal
      open={true}
      onClose={onCancel}
      title="Edit Memory"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave({ content, tags, confidence })}
            disabled={!content.trim()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-4">
        <FormField label="Content">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
            rows={3}
          />
        </FormField>

        <FormField label="Tags">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                placeholder="Add tag..."
                className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
              />
              <Button variant="secondary" onClick={handleAddTag} size="sm">
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Surface
                    key={tag}
                    variant="flat"
                    radius="sm"
                    padding="none"
                    className="text-xs px-2 py-1 flex items-center gap-1"
                  >
                    <span className="text-[var(--color-accent-selected)]">{tag}</span>
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="text-text-secondary hover:text-[var(--color-accent-rose)]"
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </Surface>
                ))}
              </div>
            )}
          </div>
        </FormField>

        <FormField label="Confidence">
          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="text-sm text-text-secondary">
              {Math.round(confidence * 100)}%
            </div>
          </div>
        </FormField>
      </div>
    </Modal>
  );
}

function AddMemoryModal({ familyId, onSave, onCancel }: {
  familyId: string;
  onSave: (memory: Omit<FamilyMemory, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<MemoryCategory>('note');
  const [content, setContent] = useState('');
  const [key, setKey] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [confidence, setConfidence] = useState(0.8);
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleSubmit = () => {
    if (!content.trim()) return;

    onSave({
      familyId,
      userId: 'demo-user',
      category,
      key: key || content.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50),
      content,
      tags,
      confidence,
    });
  };

  return (
    <Modal
      open={true}
      onClose={onCancel}
      title="Add Memory"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!content.trim()}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-4">
        <FormField label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryCategory)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
          >
            <option value="preference">Preference</option>
            <option value="allergy">Allergy</option>
            <option value="routine">Routine</option>
            <option value="location">Location</option>
            <option value="schedule">Schedule</option>
            <option value="personality">Personality</option>
            <option value="restriction">Restriction</option>
            <option value="contact">Contact</option>
            <option value="note">Note</option>
          </select>
        </FormField>

        <FormField label="Content">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="e.g., Caspian is allergic to peanuts"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
            rows={3}
          />
        </FormField>

        <FormField label="Tags">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                placeholder="Add tag..."
                className="flex-1 px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-selected)]"
              />
              <Button variant="secondary" onClick={handleAddTag} size="sm">
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Surface
                    key={tag}
                    variant="flat"
                    radius="sm"
                    padding="none"
                    className="text-xs px-2 py-1 flex items-center gap-1"
                  >
                    <span className="text-[var(--color-accent-selected)]">{tag}</span>
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="text-text-secondary hover:text-[var(--color-accent-rose)]"
                      aria-label={`Remove ${tag}`}
                    >
                      ×
                    </button>
                  </Surface>
                ))}
              </div>
            )}
          </div>
        </FormField>

        <FormField label="Confidence">
          <div className="space-y-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={confidence}
              onChange={(e) => setConfidence(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="text-sm text-text-secondary">
              {Math.round(confidence * 100)}%
            </div>
          </div>
        </FormField>
      </div>
    </Modal>
  );
}
