"use client";

import React, { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

interface Member {
  name: string;
  role: "Parent" | "Child";
  emoji: string;
  color: "green" | "cyan" | "violet" | "amber";
  age?: string;
  joined?: string;
}

interface MemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  member?: Member;
  onSave: (member: Omit<Member, 'joined'>) => void;
  onDelete?: (memberName: string) => void;
}

const roleOptions = ["Parent", "Child"] as const;
const colorOptions = [
  { name: "Green", value: "green", emoji: "🟢" },
  { name: "Cyan", value: "cyan", emoji: "🔵" },
  { name: "Violet", value: "violet", emoji: "🟣" },
  { name: "Amber", value: "amber", emoji: "🟡" },
] as const;

const emojiOptions = [
  "😊", "😄", "😃", "😀", "😊", "🙂", "🤗", "🤩",
  "👨", "👩", "🧒", "👧", "👦", "👶", "🧑", "👨‍🦱",
  "👩‍🦱", "🧔", "👨‍🦰", "👩‍🦰", "👨‍🦳", "👩‍🦳"
];

export default function MemberModal({ isOpen, onClose, member, onSave, onDelete }: MemberModalProps) {
  const [formData, setFormData] = useState({
    name: member?.name || "",
    role: member?.role || "Child",
    emoji: member?.emoji || "😊",
    color: member?.color || "green",
    age: member?.age || "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    if (!formData.age.trim()) {
      newErrors.age = "Age is required";
    } else if (isNaN(Number(formData.age))) {
      newErrors.age = "Age must be a number";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validateForm()) return;

    onSave({
      name: formData.name.trim(),
      role: formData.role as "Parent" | "Child",
      emoji: formData.emoji,
      color: formData.color as "green" | "cyan" | "violet" | "amber",
      age: formData.age,
    });

    onClose();
  };

  const handleDelete = () => {
    if (member && onDelete) {
      onDelete(member.name);
      onClose();
    }
  };

  const resetForm = () => {
    setFormData({
      name: member?.name || "",
      role: member?.role || "Child",
      emoji: member?.emoji || "😊",
      color: member?.color || "green",
      age: member?.age || "",
    });
    setErrors({});
  };

  // Reset form when modal opens/closes or member changes
  React.useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, member]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <Card className="border-0 shadow-none bg-transparent">
          <div className="p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">
            {member ? "Edit Member" : "Add New Member"}
          </h3>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-surface-2 border border-surface-3 rounded-lg text-text-primary placeholder-text-muted focus:border-nori-500 focus:outline-none"
                placeholder="Enter full name"
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            {/* Role */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Role
              </label>
              <div className="flex gap-2">
                {roleOptions.map((role) => (
                  <button
                    key={role}
                    onClick={() => setFormData({ ...formData, role })}
                    className={`px-4 py-2 rounded-lg border transition-colors ${
                      formData.role === role
                        ? "bg-nori-500 border-nori-500 text-white"
                        : "bg-surface-2 border-surface-3 text-text-primary hover:border-nori-500"
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

            {/* Age */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Age
              </label>
              <input
                type="number"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                className="w-full px-3 py-2 bg-surface-2 border border-surface-3 rounded-lg text-text-primary placeholder-text-muted focus:border-nori-500 focus:outline-none"
                placeholder="Enter age"
                min="0"
                max="120"
              />
              {errors.age && <p className="text-red-400 text-xs mt-1">{errors.age}</p>}
            </div>

            {/* Color */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Color
              </label>
              <div className="grid grid-cols-4 gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => setFormData({ ...formData, color: color.value })}
                    className={`p-3 rounded-lg border-2 transition-all ${
                      formData.color === color.value
                        ? "border-nori-500 bg-nori-500/10"
                        : "border-surface-3 bg-surface-2 hover:border-surface-4"
                    }`}
                  >
                    <div className="text-center">
                      <div
                        className={`w-6 h-6 rounded-full mx-auto mb-1 ${
                          color.value === "green" ? "bg-nori-400" :
                          color.value === "cyan" ? "bg-cyan-400" :
                          color.value === "violet" ? "bg-violet-400" :
                          "bg-amber-400"
                        }`}
                      />
                      <span className="text-xs text-text-primary">{color.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Emoji */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Emoji
              </label>
              <div className="grid grid-cols-6 gap-2 max-h-32 overflow-y-auto">
                {emojiOptions.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => setFormData({ ...formData, emoji })}
                    className={`p-2 text-2xl rounded-lg transition-all ${
                      formData.emoji === emoji
                        ? "bg-nori-500/20 ring-2 ring-nori-500"
                        : "bg-surface-2 hover:bg-surface-3"
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-surface-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleSave}
            >
              {member ? "Save Changes" : "Add Member"}
            </Button>
          </div>

          {/* Delete Button (only for existing members) */}
          {member && onDelete && (
            <div className="mt-4 pt-4 border-t border-surface-3">
              <Button
                variant="danger"
                className="w-full"
                onClick={handleDelete}
              >
                Delete Member
              </Button>
            </div>
          )}
          </div>
        </Card>
      </div>
    </div>
  );
}