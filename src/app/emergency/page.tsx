import Link from "next/link";
import PageShell from "@/components/ui/PageShell";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

const emergencyContacts = [
  { name: "Mom", phone: "(555) 123-4567", emoji: "👩", color: "green" },
  { name: "Dad", phone: "(555) 234-5678", emoji: "👨", color: "cyan" },
  { name: "Grandma", phone: "(555) 345-6789", emoji: "👵", color: "amber" },
  { name: "Step-Dad", phone: "(555) 456-7890", emoji: "👨‍🦱", color: "violet" },
  { name: "Step-Mom", phone: "(555) 567-8901", emoji: "👩‍🦱", color: "rose" },
];

const emergencyTypes = [
  { id: "minor", label: "Minor Injury", icon: "🤕", desc: "Small cuts, scrapes, or bruises", contact: "Mom or Dad" },
  { id: "lost", label: "Lost Item", icon: "🔍", desc: "Lost keys, phone, or important item", contact: "Call home" },
  { id: "lockout", label: "Locked Out", icon: "🔒", desc: "Locked out of house or car", contact: "Mom or Dad" },
  { id: "sick", label: "Not Feeling Well", icon: "🤒", desc: "Mild illness or discomfort", contact: "Mom or Dad" },
];

export default function EmergencyPage() {
  return (
    <PageShell>
      <div
        className="px-4 pt-12 pb-4 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        <Link href="/" className="text-nori-400 text-xs font-medium mb-4 inline-block">
          ← Back to Home
        </Link>
        <h1 className="text-2xl font-bold text-text-primary">Emergency Contacts</h1>
        <p className="text-text-secondary text-sm mt-1">Quick access for urgent situations</p>
      </div>

      <div className="px-4 space-y-6 relative z-10">
        <section>
          <h2 className="text-text-primary font-semibold text-base mb-3">Primary Contacts</h2>
          <div className="grid grid-cols-2 gap-3">
            {emergencyContacts.map((contact) => (
              <Card key={contact.name} className="text-center">
                <div className="text-3xl mb-1">{contact.emoji}</div>
                <p className="text-text-primary font-medium text-sm">{contact.name}</p>
                <p className="text-text-muted text-xs mt-0.5">{contact.phone}</p>
                <Button variant="secondary" size="sm" className="mt-2 w-full">
                  Call
                </Button>
              </Card>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-text-primary font-semibold text-base mb-3">Common Situations</h2>
          <div className="space-y-2">
            {emergencyTypes.map((type) => (
              <Card key={type.id} className="flex items-center gap-3">
                <span className="text-2xl">{type.icon}</span>
                <div className="flex-1">
                  <p className="text-text-primary text-sm font-medium">{type.label}</p>
                  <p className="text-text-muted text-xs">{type.desc}</p>
                </div>
                <span className="text-xs text-text-secondary">{type.contact}</span>
              </Card>
            ))}
          </div>
        </section>

        <Card className="bg-rose-500/10 border-rose-500/20">
          <div className="text-center">
            <span className="text-3xl">🚨</span>
            <h3 className="text-rose-400 font-semibold mt-2">Life-Threatening Emergency</h3>
            <p className="text-text-muted text-xs mt-1">Call 911 immediately</p>
            <Button
              variant="danger"
              className="mt-3 w-full"
              onClick={() => alert("Dialing 911...")}
            >
              Call 911
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}