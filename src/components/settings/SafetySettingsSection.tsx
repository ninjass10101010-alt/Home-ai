"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import EmergencyTestDialog from "@/components/settings/EmergencyTestDialog";
import FormField from "@/components/patterns/FormField";
import SectionCard from "@/components/patterns/SectionCard";
import SettingsConfirmDialog from "@/components/settings/SettingsConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import IconButton from "@/components/ui/IconButton";
import ListRow from "@/components/ui/ListRow";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";
import SoftButton from "@/components/ui/SoftButton";
import Toast from "@/components/ui/Toast";
import Toggle from "@/components/ui/Toggle";
import { db } from "@/db";
import { useAuth } from "@/hooks/useAuth";
import { useSettingsFeedback } from "@/hooks/useSettingsFeedback";

type ContactId = string | number;

export interface SafetyContact {
  id: ContactId;
  name: string;
  phone: string;
  email: string;
  relationship: string;
  isPrimary: boolean;
  emoji: string;
  carrier?: string;
}

interface ContactForm {
  name: string;
  phone: string;
  email: string;
  relationship: string;
  isPrimary: boolean;
  emoji: string;
  carrier?: string;
}

interface ContactErrors {
  name?: string;
  phone?: string;
  email?: string;
}

const NAME_ID = "settings-safety-contact-name";
const NAME_ERROR_ID = "settings-safety-contact-name-error";
const PHONE_ID = "settings-safety-contact-phone";
const PHONE_HELPER_ID = "settings-safety-contact-phone-helper";
const PHONE_ERROR_ID = "settings-safety-contact-phone-error";
const EMAIL_ID = "settings-safety-contact-email";
const EMAIL_ERROR_ID = "settings-safety-contact-email-error";
const RELATIONSHIP_ID = "settings-safety-contact-relationship";
const ERROR_SUMMARY_ID = "settings-safety-contact-error-summary";
const ADD_CONTACT_ID = "settings-safety-add-contact";

const DEFAULT_CONTACT_FORM: ContactForm = {
  name: "",
  phone: "",
  email: "",
  relationship: "parent",
  isPrimary: false,
  emoji: "👤",
};

function contactEditId(id: ContactId) {
  return `settings-safety-edit-${encodeURIComponent(String(id))}`;
}

function normalizeContact(value: unknown): SafetyContact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.id == null) return null;
  const id = typeof raw.id === "string" || typeof raw.id === "number" ? raw.id : String(raw.id);
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    phone: typeof raw.phone === "string" ? raw.phone : "",
    email: typeof raw.email === "string" ? raw.email : "",
    relationship: typeof raw.relationship === "string" && raw.relationship.trim() ? raw.relationship : "other",
    isPrimary: Boolean(raw.isPrimary),
    emoji: typeof raw.emoji === "string" && raw.emoji ? raw.emoji : "👤",
    carrier: typeof raw.carrier === "string" ? raw.carrier : undefined,
  };
}

function readContacts(): SafetyContact[] {
  const rows = db.selectEmergencyContacts() as unknown;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const contact = normalizeContact(row);
    return contact ? [contact] : [];
  });
}

function formFromContact(contact?: SafetyContact): ContactForm {
  if (!contact) return { ...DEFAULT_CONTACT_FORM };
  return {
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    relationship: contact.relationship || "parent",
    isPrimary: contact.isPrimary,
    emoji: contact.emoji || "👤",
    carrier: contact.carrier,
  };
}

function firstInvalidContactId(errors: ContactErrors) {
  return errors.name ? NAME_ID : errors.phone ? PHONE_ID : errors.email ? EMAIL_ID : null;
}

export default function SafetySettingsSection() {
  const { currentUser, hydrated } = useAuth();
  const { feedback, showFeedback, clearFeedback } = useSettingsFeedback();
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactsReadError, setContactsReadError] = useState<string | null>(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<SafetyContact | null>(null);
  const [contactForm, setContactForm] = useState<ContactForm>(DEFAULT_CONTACT_FORM);
  const [contactErrors, setContactErrors] = useState<ContactErrors>({});
  const [contactOperationError, setContactOperationError] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);
  const [pendingDeleteContact, setPendingDeleteContact] = useState<SafetyContact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingContact, setDeletingContact] = useState(false);
  const [testAlertOpen, setTestAlertOpen] = useState(false);
  const contactMutationInFlightRef = useRef(false);
  const contactFormSessionRef = useRef(0);
  const deleteSessionRef = useRef(0);
  const contactsLoadedRef = useRef(false);
  const focusFirstErrorRef = useRef(false);
  const deleteFocusTargetRef = useRef<ContactId | "add" | null>(null);
  const deleteFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousParentRef = useRef(false);
  const parentAccessRef = useRef(false);
  const mountedRef = useRef(true);
  const isParent = hydrated && currentUser?.role === "parent";

  useEffect(() => {
    parentAccessRef.current = isParent;
  }, [isParent]);

  useEffect(() => {
    let active = true;
    const commitContacts = () => {
      if (!active || !mountedRef.current || !isParent) return;
      try {
        setContacts(readContacts());
        setContactsReadError(null);
      } catch {
        setContactsReadError("Couldn't load emergency contacts. Try reopening Safety.");
      } finally {
        setContactsLoaded(true);
      }
    };
    const onRefreshed = () => commitContacts();

    if (!isParent) {
      if (!contactsLoadedRef.current) return;
      contactsLoadedRef.current = false;
      const timer = setTimeout(() => {
        if (!active || !mountedRef.current) return;
        setContacts([]);
        setContactsLoaded(false);
        setContactsReadError(null);
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }

    window.addEventListener("consuela-data-refreshed", onRefreshed);
    if (contactsLoadedRef.current) {
      return () => {
        active = false;
        window.removeEventListener("consuela-data-refreshed", onRefreshed);
      };
    }
    contactsLoadedRef.current = true;
    setContactsLoaded(false);
    setContactsReadError(null);
    const timer = setTimeout(commitContacts, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("consuela-data-refreshed", onRefreshed);
    };
  }, [isParent]);

  useLayoutEffect(() => {
    const wasParent = previousParentRef.current;
    previousParentRef.current = isParent;
    if (!wasParent || isParent) return;
    contactFormSessionRef.current += 1;
    deleteSessionRef.current += 1;
    contactMutationInFlightRef.current = false;
    deleteFocusTargetRef.current = null;
    if (deleteFocusTimerRef.current) {
      clearTimeout(deleteFocusTimerRef.current);
      deleteFocusTimerRef.current = null;
    }
    if (!mountedRef.current) return;
    setContactModalOpen(false);
    setPendingDeleteContact(null);
    setContactOperationError(null);
    setDeleteError(null);
    setSavingContact(false);
    setDeletingContact(false);
    setTestAlertOpen(false);
    clearFeedback();
  }, [clearFeedback, isParent]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      contactFormSessionRef.current += 1;
      deleteSessionRef.current += 1;
      if (deleteFocusTimerRef.current) clearTimeout(deleteFocusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!focusFirstErrorRef.current) return;
    focusFirstErrorRef.current = false;
    if (!mountedRef.current || !isParent) return;
    const firstInvalidId = firstInvalidContactId(contactErrors);
    if (firstInvalidId) document.getElementById(firstInvalidId)?.focus();
  }, [contactErrors, isParent]);

  if (!hydrated) {
    return (
      <section aria-label="Safety settings" aria-busy="true" className="rounded-3xl border border-white/10 bg-[var(--color-surface-0)]/35 p-6">
        <p className="text-sm text-text-secondary">Checking your safety settings…</p>
      </section>
    );
  }

  const openContactModal = (contact?: SafetyContact) => {
    if (contactMutationInFlightRef.current) return;
    contactFormSessionRef.current += 1;
    setEditingContact(contact ?? null);
    setContactForm(formFromContact(contact));
    setContactErrors({});
    setContactOperationError(null);
    setContactModalOpen(true);
  };

  const closeContactModal = () => {
    if (contactMutationInFlightRef.current) return;
    contactFormSessionRef.current += 1;
    setContactModalOpen(false);
    setContactOperationError(null);
  };

  const validateContact = () => {
    const errors: ContactErrors = {};
    if (!contactForm.name.trim()) errors.name = "Enter a name for this contact.";
    if (!contactForm.phone.trim()) errors.phone = "Enter a phone number so alerts can reach them.";
    else if (contactForm.phone.replace(/\D/g, "").length < 7) {
      errors.phone = "That number looks too short — include the country code, e.g. +15551234567.";
    }
    if (!contactForm.email.trim()) errors.email = "Enter an email as a backup alert channel.";
    else if (!/^\S+@\S+\.\S+$/.test(contactForm.email.trim())) {
      errors.email = "That email looks incomplete — try something like name@example.com.";
    }
    setContactErrors(errors);
    focusFirstErrorRef.current = Object.keys(errors).length > 0;
    return Object.keys(errors).length === 0;
  };

  const contactPayload = () => {
    const payload: Record<string, unknown> = {
      name: contactForm.name.trim(),
      phone: contactForm.phone.trim(),
      email: contactForm.email.trim(),
      relationship: contactForm.relationship || "parent",
      isPrimary: Boolean(contactForm.isPrimary),
      emoji: contactForm.emoji || "👤",
    };
    if (contactForm.carrier) payload.carrier = contactForm.carrier;
    return payload;
  };

  const reportContactError = (message: string) => {
    setContactOperationError(message);
    showFeedback(message, "error");
  };

  const reportDeleteError = (message: string) => {
    setDeleteError(message);
    showFeedback(message, "error");
  };

  const saveContact = async () => {
    if (contactMutationInFlightRef.current || !validateContact()) return;
    contactMutationInFlightRef.current = true;
    setSavingContact(true);
    setContactOperationError(null);
    const session = contactFormSessionRef.current;
    const isEditing = editingContact !== null;
    const editingId = editingContact?.id;
    const payload = contactPayload();
    const isCurrentSession = () => mountedRef.current && parentAccessRef.current && contactFormSessionRef.current === session;

    try {
      const result = isEditing
        ? await db.updateEmergencyContact(editingId!, payload)
        : await db.insertEmergencyContact(payload);
      if (!isCurrentSession() || !contactMutationInFlightRef.current) return;
      if (!result) {
        reportContactError(isEditing
          ? "Couldn't update contact. Check the connection and try again."
          : "Couldn't add contact. Check the connection and try again.");
        return;
      }
      setContacts(readContacts());
      setContactsLoaded(true);
      setContactModalOpen(false);
      showFeedback(`${isEditing ? "✅ Updated" : "✅ Added"} ${String(payload.name)}`, "success");
    } catch {
      if (!isCurrentSession()) return;
      reportContactError(isEditing
        ? "Couldn't update contact. Check the connection and try again."
        : "Couldn't add contact. Check the connection and try again.");
    } finally {
      if (isCurrentSession() && contactMutationInFlightRef.current) {
        contactMutationInFlightRef.current = false;
        setSavingContact(false);
      }
    }
  };

  const openDeleteContact = (contact: SafetyContact) => {
    if (contactMutationInFlightRef.current) return;
    const index = contacts.findIndex((candidate) => candidate.id === contact.id);
    const nextContact = index >= 0 ? contacts[index + 1] : undefined;
    deleteFocusTargetRef.current = nextContact?.id ?? "add";
    deleteSessionRef.current += 1;
    setPendingDeleteContact(contact);
    setDeleteError(null);
  };

  const closeDeleteContact = () => {
    if (deletingContact) return;
    deleteSessionRef.current += 1;
    deleteFocusTargetRef.current = null;
    setPendingDeleteContact(null);
    setDeleteError(null);
  };

  const deleteContact = async (contact: SafetyContact) => {
    if (contactMutationInFlightRef.current) return;
    contactMutationInFlightRef.current = true;
    setDeletingContact(true);
    setDeleteError(null);
    const session = deleteSessionRef.current;
    const isCurrentSession = () => mountedRef.current && parentAccessRef.current && deleteSessionRef.current === session;

    try {
      const result = await db.deleteEmergencyContact(contact.id);
      if (!isCurrentSession() || !contactMutationInFlightRef.current) return;
      if (result !== true) {
        reportDeleteError("Couldn't remove contact. Check the connection and try again.");
        return;
      }
      setContacts(readContacts());
      setContactsLoaded(true);
      setPendingDeleteContact(null);
      const focusTarget = deleteFocusTargetRef.current;
      deleteFocusTargetRef.current = null;
      showFeedback(`🗑️ Removed ${contact.name}`, "success");
      if (deleteFocusTimerRef.current) clearTimeout(deleteFocusTimerRef.current);
      deleteFocusTimerRef.current = setTimeout(() => {
        deleteFocusTimerRef.current = null;
        if (!mountedRef.current || !parentAccessRef.current) return;
        const targetId = focusTarget === "add" ? ADD_CONTACT_ID : focusTarget == null ? null : contactEditId(focusTarget);
        if (targetId) document.getElementById(targetId)?.focus();
      }, 0);
    } catch {
      if (isCurrentSession()) {
        reportDeleteError("Couldn't remove contact. Check the connection and try again.");
      }
    } finally {
      if (isCurrentSession() && contactMutationInFlightRef.current) {
        contactMutationInFlightRef.current = false;
        setDeletingContact(false);
      }
    }
  };

  const contactBusy = savingContact || deletingContact;
  const confirmDeleteLabel = deleteError ? "Retry" : "Remove contact";
  const hasContactErrors = Object.values(contactErrors).some(Boolean);

  const referenceCard = (
    <SectionCard
      title="Emergency reference"
      description="Call cards, common situations, and 911 reference."
      icon="🛡️"
      tone="var(--color-accent-rose)"
      headingLevel="h2"
    >
      <Link
        href="/emergency"
        className="tap flex min-h-14 items-center justify-between rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 px-4 text-sm font-semibold text-text-primary no-underline"
      >
        <span>Open emergency reference</span>
        <span aria-hidden="true">›</span>
      </Link>
    </SectionCard>
  );

  return (
    <section aria-labelledby="settings-safety-heading" data-settings-safety="true" className="space-y-5">
      {isParent ? <Toast open={feedback !== null} tone={feedback?.tone}>{feedback?.message}</Toast> : null}
      <div className="sr-only">
        <h2 id="settings-safety-heading">Safety</h2>
      </div>
      {referenceCard}
      {isParent ? (
        <>
          <SectionCard title="Emergency contacts" description="Primary contacts receive serious alerts; other contacts are reference-only." icon="🛡️" headingLevel="h2">
            <div className="space-y-3" aria-busy={!contactsLoaded}>
              {!contactsLoaded ? (
                <div data-safety-contacts-loading="true" role="status" aria-label="Loading emergency contacts">
                  <Skeleton variant="card" />
                </div>
              ) : contactsReadError ? (
                <p role="alert" className="rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 p-3 text-sm font-semibold text-[var(--color-accent-rose)]">
                  {contactsReadError}
                </p>
              ) : (
                contacts.map((contact) => (
                  <ListRow
                    key={String(contact.id)}
                    title={(
                      <span className="flex items-center gap-2">
                        <span className="truncate">{contact.name}</span>
                        {contact.isPrimary ? <span data-testid="primary-contact-badge" className="shrink-0 rounded-full bg-[var(--color-accent-rose)]/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-rose)]">Primary</span> : null}
                      </span>
                    )}
                    subtitle={`${contact.phone} · ${contact.email}`}
                    leftRailColor={contact.isPrimary ? "var(--color-accent-rose)" : "var(--color-accent-sage)"}
                    leading={<span className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--color-surface-2)] text-xl" aria-hidden="true">{contact.emoji}</span>}
                    trailing={(
                      <div className="flex items-center gap-1">
                        <IconButton
                          id={contactEditId(contact.id)}
                          size="sm"
                          variant="ghost"
                          aria-label={`Edit ${contact.name}`}
                          disabled={contactBusy}
                          onClick={() => openContactModal(contact)}
                        >
                          ✎
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="danger"
                          aria-label={`Remove ${contact.name}`}
                          disabled={contactBusy}
                          className="relative before:absolute before:-inset-1 before:content-['']"
                          onClick={() => openDeleteContact(contact)}
                        >
                          ×
                        </IconButton>
                      </div>
                    )}
                  />
                ))
              )}
              {contactsLoaded && !contactsReadError && contacts.length === 0 ? (
                <EmptyState title="No emergency contacts" description="Add a primary contact for serious alerts." actionLabel="Add contact" onAction={() => openContactModal()} />
              ) : null}
            </div>
            <div className="mt-4 flex gap-2">
              <SoftButton id={ADD_CONTACT_ID} onClick={() => openContactModal()} disabled={contactBusy || !contactsLoaded} className="flex-1">Add contact</SoftButton>
              <SoftButton variant="secondary" onClick={() => setTestAlertOpen(true)} disabled={contactBusy || !contactsLoaded} className="flex-1">
                Test emergency alert
              </SoftButton>
            </div>
          </SectionCard>
          <EmergencyTestDialog open={testAlertOpen} onClose={() => setTestAlertOpen(false)} />
        </>
      ) : null}
      <Modal
        open={isParent && contactModalOpen}
        onClose={closeContactModal}
        title={editingContact ? "Edit contact" : "Add contact"}
        description="Primary contacts receive serious emergency alerts from the Home FAB."
        panelClassName="settings-dialog"
        footer={(
          <>
            <SoftButton type="submit" form="settings-safety-contact-form" loading={savingContact} disabled={savingContact} className="flex-1">Save</SoftButton>
            <SoftButton variant="secondary" onClick={closeContactModal} disabled={savingContact} className="flex-1">Cancel</SoftButton>
          </>
        )}
      >
        <form
          id="settings-safety-contact-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void saveContact();
          }}
        >
          <fieldset disabled={savingContact} className="space-y-4 border-0 p-0">
          {hasContactErrors ? <p id={ERROR_SUMMARY_ID} data-contact-error-summary="true" role="alert" tabIndex={-1} className="rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 p-3 text-sm font-semibold text-[var(--color-accent-rose)]">Fix the highlighted contact fields.</p> : null}
          {contactOperationError ? <p role="alert" className="rounded-2xl border border-[var(--color-accent-rose)]/25 bg-[var(--color-accent-rose)]/10 p-3 text-sm font-semibold text-[var(--color-accent-rose)]">{contactOperationError}</p> : null}
          <FormField label="Name" controlId={NAME_ID} errorId={NAME_ERROR_ID} errorText={contactErrors.name}>
            <input
              id={NAME_ID}
              aria-invalid={Boolean(contactErrors.name)}
              aria-describedby={contactErrors.name ? NAME_ERROR_ID : undefined}
              value={contactForm.name}
              onChange={(event) => {
                if (savingContact) return;
                setContactForm((current) => ({ ...current, name: event.target.value }));
                setContactErrors((current) => ({ ...current, name: undefined }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary"
              placeholder="Contact name"
            />
          </FormField>
          <FormField
            label="Phone"
            controlId={PHONE_ID}
            helperId={PHONE_HELPER_ID}
            errorId={PHONE_ERROR_ID}
            helperText="Include the country code so carrier SMS gateways can deliver."
            errorText={contactErrors.phone}
          >
            <input
              id={PHONE_ID}
              type="tel"
              aria-invalid={Boolean(contactErrors.phone)}
              aria-describedby={contactErrors.phone ? PHONE_ERROR_ID : PHONE_HELPER_ID}
              value={contactForm.phone}
              onChange={(event) => {
                if (savingContact) return;
                setContactForm((current) => ({ ...current, phone: event.target.value }));
                setContactErrors((current) => ({ ...current, phone: undefined }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary"
              placeholder="+15551234567"
            />
          </FormField>
          <FormField label="Email" controlId={EMAIL_ID} errorId={EMAIL_ERROR_ID} errorText={contactErrors.email}>
            <input
              id={EMAIL_ID}
              type="email"
              aria-invalid={Boolean(contactErrors.email)}
              aria-describedby={contactErrors.email ? EMAIL_ERROR_ID : undefined}
              value={contactForm.email}
              onChange={(event) => {
                if (savingContact) return;
                setContactForm((current) => ({ ...current, email: event.target.value }));
                setContactErrors((current) => ({ ...current, email: undefined }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-secondary"
              placeholder="name@example.com"
            />
          </FormField>
          <FormField label="Relationship" controlId={RELATIONSHIP_ID}>
            <select
              id={RELATIONSHIP_ID}
              value={contactForm.relationship}
              onChange={(event) => {
                if (savingContact) return;
                setContactForm((current) => ({ ...current, relationship: event.target.value }));
              }}
              className="w-full rounded-2xl border border-white/10 bg-[var(--color-surface-2)] px-4 py-3 text-sm text-text-primary outline-none"
            >
              <option value="parent">Parent</option>
              <option value="guardian">Guardian</option>
              <option value="grandparent">Grandparent</option>
              <option value="neighbor">Neighbor</option>
              <option value="other">Other</option>
            </select>
          </FormField>
          <Toggle
            checked={contactForm.isPrimary}
            onCheckedChange={(checked) => {
              if (!savingContact) setContactForm((current) => ({ ...current, isPrimary: checked }));
            }}
            disabled={savingContact}
            label="Primary contact"
          />
          </fieldset>
        </form>
      </Modal>
      <SettingsConfirmDialog
        open={isParent && pendingDeleteContact !== null}
        title={pendingDeleteContact ? `Remove ${pendingDeleteContact.name}?` : "Remove contact"}
        confirmLabel={confirmDeleteLabel}
        busy={deletingContact}
        onConfirm={() => {
          if (pendingDeleteContact) void deleteContact(pendingDeleteContact);
        }}
        onClose={closeDeleteContact}
      >
        <p className="text-sm text-text-secondary">
          {pendingDeleteContact
            ? pendingDeleteContact.isPrimary
              ? `This primary contact will stop receiving serious alerts. You can add ${pendingDeleteContact.name} back anytime.`
              : `${pendingDeleteContact.name} was not an alert recipient. Removing this contact does not change serious-alert delivery.`
            : "This contact will stop receiving serious alerts."}
        </p>
        {deleteError ? <p role="alert" className="mt-3 text-sm font-semibold text-[var(--color-accent-rose)]">{deleteError}</p> : null}
      </SettingsConfirmDialog>
    </section>
  );
}
